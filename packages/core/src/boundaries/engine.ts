import {
  DEFAULT_GOD_MODULE_FAN_IN,
  DEFAULT_MAX_FILES,
  CONFIG_FILE_NAME,
  type BoundaryRule,
  type ModuleMetrics,
  type Severity,
  type Violation,
} from '@surv/shared';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleDef } from '../modules/partition.js';
import type { FileEdge } from '../graph/worldGraph.js';
import type { MisplacedGroup } from '../analytics/community.js';
import type { LayeringResult } from '../analytics/layering.js';
import { matchGlob } from './glob.js';

export interface ResolvedBoundariesConfig {
  rules: BoundaryRule[];
  godModuleFanIn: number;
  maxFiles: number;
}

export interface LoadedConfig {
  config: ResolvedBoundariesConfig;
  configFile: string | null;
  /** 配置文件解析失败时的错误信息 */
  error: string | null;
}

export function loadBoundariesConfig(repoRoot: string): LoadedConfig {
  const configFile = join(repoRoot, CONFIG_FILE_NAME);
  if (!existsSync(configFile)) {
    return {
      config: { rules: [], godModuleFanIn: DEFAULT_GOD_MODULE_FAN_IN, maxFiles: DEFAULT_MAX_FILES },
      configFile: null,
      error: null,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as BoundariesConfigRaw;
    return {
      config: {
        rules: Array.isArray(raw.rules) ? raw.rules.filter((r) => r && typeof r.from === 'string' && Array.isArray(r.deny)) : [],
        godModuleFanIn: typeof raw.godModuleFanIn === 'number' ? raw.godModuleFanIn : DEFAULT_GOD_MODULE_FAN_IN,
        maxFiles: typeof raw.maxFiles === 'number' ? raw.maxFiles : DEFAULT_MAX_FILES,
      },
      configFile,
      error: null,
    };
  } catch (err) {
    return {
      config: { rules: [], godModuleFanIn: DEFAULT_GOD_MODULE_FAN_IN, maxFiles: DEFAULT_MAX_FILES },
      configFile,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface BoundariesConfigRaw {
  rules?: BoundaryRule[];
  godModuleFanIn?: number;
  maxFiles?: number;
}

export interface BoundaryContext {
  internalEdges: readonly FileEdge[];
  /** 文件路径 → 模块 id */
  fileModule: ReadonlyMap<string, string>;
  moduleById: ReadonlyMap<string, ModuleDef>;
  moduleMetrics: ReadonlyMap<string, ModuleMetrics>;
  /** 文件级环（每个 SCC 一个数组），已过滤出真实环 */
  fileCycles: readonly (readonly string[])[];
  moduleCycles: readonly (readonly string[])[];
  rootModuleId: string;
  config: ResolvedBoundariesConfig;
  /** 图情报：错位文件分组（降级时为空数组） */
  misplaced: readonly MisplacedGroup[];
  /** 图情报：SCC 缩点分层结果 */
  layering: LayeringResult;
}

function hashId(prefix: string, parts: readonly string[]): string {
  const s = [...parts].sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) | 0) >>> 0;
  return `${prefix}:${h.toString(36)}`;
}

function shortList(paths: readonly string[], max = 6): string {
  const sorted = [...paths].sort();
  const head = sorted.slice(0, max).join(', ');
  return sorted.length > max ? `${head} 等 ${sorted.length} 个文件` : head;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** 汇总所有边界违规，按严重度→类型→id 排序，保证列表顺序稳定 */
export function evaluateBoundaries(ctx: BoundaryContext): Violation[] {
  const violations: Violation[] = [];

  // 1. 文件级循环依赖
  for (const cycle of ctx.fileCycles) {
    const modules = [...new Set(cycle.map((f) => ctx.fileModule.get(f)).filter((m): m is string => !!m))];
    violations.push({
      id: hashId('cycle', cycle),
      type: 'cycle',
      severity: 'high',
      title: `循环依赖：${shortList(cycle, 4)}`,
      detail: cycle.slice().sort().join('\n'),
      nodeIds: cycle.slice(0, 20),
      moduleIds: modules,
    });
  }

  // 2. 模块级循环依赖
  for (const cycle of ctx.moduleCycles) {
    violations.push({
      id: hashId('mcycle', cycle),
      type: 'cycle',
      severity: 'high',
      title: `省份间循环依赖：${cycle.slice().sort().join(' ⇄ ')}`,
      nodeIds: [...cycle],
      moduleIds: [...cycle],
    });
  }

  // 3. 自定义分层规则（deny），命中者优先，占用的边不再重复报深导入
  const layerHit = new Set<string>();
  for (let ri = 0; ri < ctx.config.rules.length; ri++) {
    const rule = ctx.config.rules[ri];
    for (const edge of ctx.internalEdges) {
      const fromModule = ctx.fileModule.get(edge.from);
      const toModule = ctx.fileModule.get(edge.to);
      if (!fromModule || !toModule || fromModule === toModule) continue;
      if (!matchGlob(rule.from, edge.from)) continue;
      if (!rule.deny.some((d) => matchGlob(d, edge.to))) continue;
      layerHit.add(`${edge.from}\n${edge.to}`);
      violations.push({
        id: `layer:${ri}:${edge.from}->${edge.to}`,
        type: 'layer',
        severity: 'high',
        title: `分层违规：${edge.from} → ${edge.to}`,
        detail: `规则 #${ri + 1}：from ${rule.from} 禁止依赖 ${rule.deny.join(', ')}`,
        nodeIds: [edge.from, edge.to],
        moduleIds: [fromModule, toModule],
      });
    }
  }

  // 4. 跨模块深导入：目标文件位于目标模块目录的非顶层（路径含子目录）
  for (const edge of ctx.internalEdges) {
    const fromModule = ctx.fileModule.get(edge.from);
    const toModule = ctx.fileModule.get(edge.to);
    if (!fromModule || !toModule || fromModule === toModule) continue;
    if (layerHit.has(`${edge.from}\n${edge.to}`)) continue;
    const toDef = ctx.moduleById.get(toModule);
    if (!toDef?.dir) continue;
    const prefix = `${toDef.dir}/`;
    if (!edge.to.startsWith(prefix)) continue;
    const rel = edge.to.slice(prefix.length);
    if (!rel.includes('/')) continue;
    violations.push({
      id: `deep:${edge.from}->${edge.to}`,
      type: 'deep-import',
      severity: 'medium',
      title: `深导入：${edge.from} 直达 ${toDef.name} 内部（${rel}）`,
      detail: '跨模块引用了非顶层文件，建议经由模块入口暴露',
      nodeIds: [edge.from, edge.to],
      moduleIds: [fromModule, toModule],
    });
  }

  // 5. 上帝模块 / 6. 孤岛模块
  for (const [id, m] of ctx.moduleMetrics) {
    if (m.fanIn >= ctx.config.godModuleFanIn) {
      violations.push({
        id: `god:${id}`,
        type: 'god-module',
        severity: 'low',
        title: `上帝模块：${id.replace(/^module:/, '')} 被依赖 ${m.fanIn} 次`,
        detail: `阈值 ${ctx.config.godModuleFanIn}，考虑拆分职责`,
        nodeIds: [id],
        moduleIds: [id],
      });
    }
    if (id !== ctx.rootModuleId && m.files > 0 && m.fanIn === 0 && m.fanOut === 0) {
      violations.push({
        id: `orphan:${id}`,
        type: 'orphan',
        severity: 'low',
        title: `孤岛模块：${id.replace(/^module:/, '')} 与其他省份零依赖`,
        nodeIds: [id],
        moduleIds: [id],
      });
    }
  }

  // 7. 图情报：社区错位（重构建议）——实际耦合簇与目录省份不符
  for (const g of ctx.misplaced) {
    const fromName = ctx.moduleById.get(g.fromModule)?.name ?? g.fromModule.replace(/^module:/, '');
    const toName = ctx.moduleById.get(g.toModule)?.name ?? g.toModule.replace(/^module:/, '');
    violations.push({
      id: hashId('misplaced', [g.fromModule, g.toModule, ...g.files]),
      type: 'misplaced',
      severity: 'medium',
      title: `错位文件：${fromName} 的 ${g.files.length} 个文件实际耦合在 ${toName} 群落`,
      detail: `${[...g.files].sort().join('\n')}\n\n图情报：这些文件与 ${toName} 的文件强相连（社区 ≥3 文件），建议迁入 ${toName}`,
      nodeIds: g.files.slice(0, 20),
      moduleIds: [g.fromModule, g.toModule],
    });
  }

  // 8. 图情报：熔炉循环群——≥3 个省份缩点后仍是一团
  for (const comp of ctx.layering.megaCycles) {
    const names = comp.map((id) => ctx.moduleById.get(id)?.name ?? id.replace(/^module:/, ''));
    violations.push({
      id: hashId('mega', comp),
      type: 'megacycle',
      severity: 'high',
      title: `熔炉循环群：${comp.length} 个省份缠成一团`,
      detail: `成员：${names.join(' ⇄ ')}\n整团在分层视图中占据同一地层，建议从被外部依赖最少的省份开始解环`,
      nodeIds: [...comp],
      moduleIds: [...comp],
    });
  }

  // 9. 图情报：跨层引用——模块依赖跨层直连，跳过中间层
  for (const e of ctx.layering.skipLayerEdges) {
    const fromName = ctx.moduleById.get(e.from)?.name ?? e.from.replace(/^module:/, '');
    const toName = ctx.moduleById.get(e.to)?.name ?? e.to.replace(/^module:/, '');
    violations.push({
      id: `skip:${e.from}->${e.to}`,
      type: 'skip-layer',
      severity: 'low',
      title: `跨层引用：${fromName}（第 ${e.fromLayer} 层）直连 ${toName}（第 ${e.toLayer} 层）`,
      detail: `跳过 ${e.toLayer - e.fromLayer - 1} 个中间层，共 ${e.weight} 条依赖；跨层耦合使地层结构失真`,
      nodeIds: [e.from, e.to],
      moduleIds: [e.from, e.to],
    });
  }

  return violations.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
  );
}
