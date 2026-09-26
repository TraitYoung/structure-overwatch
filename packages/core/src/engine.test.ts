import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisEngine } from './engine.js';
import { DEMO_REPO } from './testing.js';

describe('AnalysisEngine（demo 仓库全量扫描）', () => {
  it('检出全部预置违规', async () => {
    const engine = new AnalysisEngine(DEMO_REPO);
    await engine.initialScan();
    const snap = engine.store.snapshot();
    const types = new Set(snap.violations.map((v) => v.type));

    expect(types).toContain('layer');
    expect(types).toContain('cycle');
    expect(types).toContain('god-module');
    expect(types).toContain('orphan');

    // 文件级循环：authService ⇄ auditRepo
    const fileCycle = snap.violations.find((v) => v.type === 'cycle' && v.nodeIds.includes('src/services/authService.ts'));
    expect(fileCycle?.nodeIds).toContain('src/services/repo/auditRepo.ts');

    // 模块级循环：domain ⇄ utils
    const moduleCycle = snap.violations.find((v) => v.type === 'cycle' && v.nodeIds.includes('module:domain'));
    expect(moduleCycle?.moduleIds).toEqual(expect.arrayContaining(['module:domain', 'module:utils']));

    // 分层违规命中自定义规则；同一深导入被抑制
    expect(snap.violations.some((v) => v.type === 'layer' && v.nodeIds.includes('src/ui/panel.ts'))).toBe(true);
    expect(
      snap.violations.some(
        (v) => v.type === 'deep-import' && v.id.includes('src/ui/panel.ts->src/services/repo/userRepo.ts'),
      ),
    ).toBe(false);
    // 领域层直挖 utils 内部 → 深导入
    expect(snap.violations.some((v) => v.type === 'deep-import' && v.id.includes('format/money'))).toBe(true);

    // 上帝模块 utils / 孤岛 legacy
    expect(snap.violations.some((v) => v.type === 'god-module' && v.nodeIds.includes('module:utils'))).toBe(true);
    expect(snap.violations.some((v) => v.type === 'orphan' && v.nodeIds.includes('module:legacy'))).toBe(true);

    // 外部包节点、模块指标、边界配置信息
    expect(snap.nodes.some((n) => n.id === 'ext:zod')).toBe(true);
    const ui = snap.nodes.find((n) => n.id === 'module:ui');
    expect(ui?.metrics?.kind).toBe('module');
    expect(ui?.metrics && 'files' in ui.metrics ? ui.metrics.files : 0).toBe(2);
    expect(snap.boundariesInfo.rulesConfigured).toBe(1);
    expect(snap.boundariesInfo.godModuleFanIn).toBe(4);
    expect(snap.status.state).toBe('watching');
  });
});

describe('AnalysisEngine（增量更新）', () => {
  it('增删改文件产生正确 diff 与事件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surv-eng-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tmp-repo' }));
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/a.ts'), "import { b } from './b';\nexport const a = () => b();\n");
      writeFileSync(join(dir, 'src/b.ts'), 'export const b = 1;\n');

      const engine = new AnalysisEngine(dir);
      await engine.initialScan();
      let snap = engine.store.snapshot();
      expect(snap.version).toBe(1);
      expect(snap.nodes.filter((n) => n.kind === 'file')).toHaveLength(2);

      // 新增文件
      writeFileSync(join(dir, 'src/c.ts'), "import { b } from './b';\nexport const c = b + 1;\n");
      await engine.enqueueFileEvents([{ type: 'add', absPath: join(dir, 'src/c.ts') }]);
      snap = engine.store.snapshot();
      expect(snap.version).toBe(2);
      expect(snap.nodes.some((n) => n.id === 'src/c.ts')).toBe(true);
      expect(snap.edges.some((e) => e.from === 'src/c.ts' && e.to === 'src/b.ts')).toBe(true);
      expect(snap.events.some((e) => e.kind === 'file-added' && e.message.includes('src/c.ts'))).toBe(true);

      // 修改 b 引用 a → 形成循环依赖
      writeFileSync(join(dir, 'src/b.ts'), "import { a } from './a';\nexport const b = 1;\n");
      await engine.enqueueFileEvents([{ type: 'change', absPath: join(dir, 'src/b.ts') }]);
      snap = engine.store.snapshot();
      const cycle = snap.violations.find((v) => v.type === 'cycle');
      expect(cycle?.nodeIds).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']));
      expect(snap.events.some((e) => e.kind === 'violation-new')).toBe(true);

      // 删除 c → 循环解除、节点移除
      rmSync(join(dir, 'src/c.ts'));
      await engine.enqueueFileEvents([{ type: 'unlink', absPath: join(dir, 'src/c.ts') }]);
      snap = engine.store.snapshot();
      expect(snap.version).toBe(4); // 删除也会推进版本
      expect(snap.nodes.some((n) => n.id === 'src/c.ts')).toBe(false);
      expect(snap.events.some((e) => e.kind === 'file-removed')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('健康度显著下降触发事件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surv-hp-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'hp-repo' }));
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/simple.ts'), 'export const x = 1;\n');
      const engine = new AnalysisEngine(dir);
      await engine.initialScan();
      const healthBefore = engine.store.snapshot().nodes.find((n) => n.kind === 'module')?.metrics;
      expect(healthBefore && 'health' in healthBefore ? healthBefore.health : 0).toBeGreaterThan(80);

      // 写入高复杂度文件把模块健康度拉低
      const branches = Array.from({ length: 30 }, (_, i) => `if (x === ${i}) { return ${i}; }`).join(' else ');
      writeFileSync(join(dir, 'src/complex.ts'), `const x = 5;\nfunction pick(): number { ${branches} return -1; }\n`);
      await engine.enqueueFileEvents([{ type: 'add', absPath: join(dir, 'src/complex.ts') }]);
      const events = engine.store.snapshot().events;
      expect(events.some((e) => e.kind === 'health-change')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
