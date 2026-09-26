import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computePartition, ROOT_MODULE_ID } from './partition.js';
import { DEMO_REPO } from '../testing.js';

describe('computePartition（src 结构）', () => {
  const { modules, moduleIdOf } = computePartition(DEMO_REPO, [
    'src/index.ts',
    'src/ui/panel.ts',
    'src/services/repo/db.ts',
    'src/utils/date.ts',
    'src/legacy/old.ts',
  ]);

  it('顶层目录成为省份', () => {
    const names = modules.map((m) => m.name);
    expect(names).toContain('ui');
    expect(names).toContain('services');
    expect(names).toContain('utils');
    expect(names).toContain('legacy');
  });

  it('文件归属：src/<dir>/** → 模块 dir，src 顶层 → 根模块', () => {
    expect(moduleIdOf('src/ui/panel.ts')).toBe('module:ui');
    expect(moduleIdOf('src/services/repo/db.ts')).toBe('module:services');
    expect(moduleIdOf('src/index.ts')).toBe(ROOT_MODULE_ID);
  });
});

describe('computePartition（monorepo workspace）', () => {
  it('workspace 子包成为省份', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surv-part-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }));
      mkdirSync(join(dir, 'packages/a'), { recursive: true });
      writeFileSync(join(dir, 'packages/a/package.json'), JSON.stringify({ name: '@mono/a' }));
      mkdirSync(join(dir, 'packages/a/src'), { recursive: true });
      writeFileSync(join(dir, 'packages/a/src/x.ts'), 'export const x = 1;\n');

      const { modules, moduleIdOf } = computePartition(dir, ['packages/a/src/x.ts', 'scripts/build.ts']);
      expect(modules.map((m) => m.name)).toContain('@mono/a');
      expect(moduleIdOf('packages/a/src/x.ts')).toBe('module:@mono/a');
      expect(moduleIdOf('scripts/build.ts')).toBe(ROOT_MODULE_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
