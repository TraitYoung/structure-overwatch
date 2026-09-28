import type { FileMetrics, GraphEdge, GraphNode, ModuleMetrics, Violation } from '@surv/shared';
import type { WorldGraph, FileEdge } from '../graph/worldGraph.js';
import { toGraphEdge } from '../graph/worldGraph.js';
import { cycleComponents, stronglyConnectedComponents } from '../graph/scc.js';
import { fileHealth } from '../metrics/metrics.js';
import { ROOT_MODULE_ID, type ModuleDef } from '../modules/partition.js';
import { evaluateBoundaries, type ResolvedBoundariesConfig } from '../boundaries/engine.js';
import { pageRank } from '../analytics/pagerank.js';
import { detectCommunities, findMisplacedGroups } from '../analytics/community.js';
import { computeLayering } from '../analytics/layering.js';

export interface WorldModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  violations: Violation[];
  fileCycles: string[][];
  moduleCycles: string[][];
  moduleHealth: Map<string, number>;
  fileCount: number;
  /** 图情报：有分析值的文件（pagerank 保留 3 位小数），供引擎 diff 重发与趋势播报 */
  fileAnalytics: Map<string, { pagerank: number; community: number }>;
  /** 图情报趋势：当前承重墙 Top1 与最大模块循环群规模 */
  graphTrends: { topFile: { id: string; pagerank: number } | null; largestModuleCycle: number };
}

export interface BuildWorldInput {
  graph: WorldGraph;
  fileModule: ReadonlyMap<string, string>;
  modules: readonly ModuleDef[];
  config: ResolvedBoundariesConfig;
}

/** 从文件图全量推导：节点指标、模块聚合、循环检测与边界违规 */
export function buildWorld(input: BuildWorldInput): WorldModel {
  const { graph, fileModule, config } = input;
  const files = graph.allFiles();
  const allEdges = graph.fileEdges();

  const internalEdges = allEdges.filter((e) => !e.external && fileModule.has(e.from) && fileModule.has(e.to));

  // 文件 fan-in/out（仅内部边）
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const e of internalEdges) {
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }

  // 文件级环
  const fileAdj = new Map<string, string[]>();
  for (const e of internalEdges) {
    const list = fileAdj.get(e.from) ?? [];
    if (!list.includes(e.to)) list.push(e.to);
    fileAdj.set(e.from, list);
  }
  for (const key of fileAdj.keys()) fileAdj.get(key)!.sort();
  const fileCycles = cycleComponents(stronglyConnectedComponents(fileAdj), fileAdj);
  const inCycle = new Set(fileCycles.flat());

  // ---- 图情报（文件级）：超限降级时跳过，仅保留模块级 ----
  const fileLevelOn = files.size <= config.maxFiles;
  const filePr = fileLevelOn ? pageRank(fileAdj) : null;
  const fileCommunities = fileLevelOn ? detectCommunities(fileAdj) : null;
  const misplaced = fileCommunities
    ? findMisplacedGroups(fileCommunities.communities, fileModule, internalEdges)
    : [];

  // 文件节点
  const fileNodes: GraphNode[] = [];
  const moduleAgg = new Map<string, { files: number; loc: number; complexity: number; healthWeighted: number }>();
  for (const [path, pf] of files) {
    const moduleId = fileModule.get(path) ?? ROOT_MODULE_ID;
    const pr = filePr?.get(path);
    const cm = fileCommunities?.labelOf.get(path);
    const metrics: FileMetrics = {
      kind: 'file',
      loc: pf.loc,
      complexity: pf.complexity,
      fanIn: fanIn.get(path) ?? 0,
      fanOut: fanOut.get(path) ?? 0,
      health: fileHealth(pf.loc, pf.complexity, inCycle.has(path)),
      ...(pr !== undefined ? { pagerank: Math.round(pr * 1000) / 1000 } : {}),
      ...(cm !== undefined ? { community: cm } : {}),
    };
    fileNodes.push({ id: path, kind: 'file', name: path.split('/').pop() ?? path, path, moduleId, metrics });
    const agg = moduleAgg.get(moduleId) ?? { files: 0, loc: 0, complexity: 0, healthWeighted: 0 };
    agg.files += 1;
    agg.loc += pf.loc;
    agg.complexity += pf.complexity;
    agg.healthWeighted += metrics.health * pf.loc;
    moduleAgg.set(moduleId, agg);
  }

  // 模块级跨模块边（内部文件边聚合）
  const moduleEdgeWeight = new Map<string, { from: string; to: string; weight: number }>();
  for (const e of internalEdges) {
    const fm = fileModule.get(e.from)!;
    const tm = fileModule.get(e.to)!;
    if (fm === tm) continue;
    const key = `${fm}|${tm}`;
    const cur = moduleEdgeWeight.get(key);
    if (cur) cur.weight += 1;
    else moduleEdgeWeight.set(key, { from: fm, to: tm, weight: 1 });
  }

  // 模块 fan-in/out 与模块级环
  const moduleFanIn = new Map<string, number>();
  const moduleFanOut = new Map<string, number>();
  const moduleAdj = new Map<string, string[]>();
  for (const { from, to, weight } of moduleEdgeWeight.values()) {
    moduleFanIn.set(to, (moduleFanIn.get(to) ?? 0) + weight);
    moduleFanOut.set(from, (moduleFanOut.get(from) ?? 0) + weight);
    const list = moduleAdj.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    moduleAdj.set(from, list);
  }
  for (const key of moduleAdj.keys()) moduleAdj.get(key)!.sort();
  const moduleCycles = cycleComponents(stronglyConnectedComponents(moduleAdj), moduleAdj);
  const cyclicModules = new Set(moduleCycles.flat());
  for (const cycle of fileCycles) {
    for (const f of cycle) {
      const m = fileModule.get(f);
      if (m) cyclicModules.add(m);
    }
  }

  // ---- 图情报（模块级）：始终计算（省份数量级小） ----
  const modulePr = pageRank(moduleAdj);
  const moduleCommunities = detectCommunities(moduleAdj);
  const layering = computeLayering(moduleAdj, moduleEdgeWeight, input.modules.map((m) => m.id));

  // 模块节点
  const moduleNodes: GraphNode[] = [];
  const moduleMetrics = new Map<string, ModuleMetrics>();
  const moduleById = new Map<string, ModuleDef>(input.modules.map((m) => [m.id, m]));
  for (const mod of input.modules) {
    const agg = moduleAgg.get(mod.id);
    if (!agg) continue;
    const fanInCount = moduleFanIn.get(mod.id) ?? 0;
    const fanOutCount = moduleFanOut.get(mod.id) ?? 0;
    const denom = fanInCount + fanOutCount;
    const mpr = modulePr.get(mod.id);
    const mcm = moduleCommunities.labelOf.get(mod.id);
    const mlayer = layering.layerOfModule.get(mod.id);
    const metrics: ModuleMetrics = {
      kind: 'module',
      files: agg.files,
      loc: agg.loc,
      complexity: agg.files > 0 ? Math.round((agg.complexity / agg.files) * 10) / 10 : 0,
      fanIn: fanInCount,
      fanOut: fanOutCount,
      instability: denom > 0 ? Math.round((fanOutCount / denom) * 100) / 100 : 0,
      health: agg.loc > 0 ? Math.round(agg.healthWeighted / agg.loc) : 100,
      cyclic: cyclicModules.has(mod.id),
      ...(mpr !== undefined ? { pagerank: mpr } : {}),
      ...(mcm !== undefined ? { community: mcm } : {}),
      ...(mlayer !== undefined ? { layer: mlayer } : {}),
    };
    moduleMetrics.set(mod.id, metrics);
    moduleNodes.push({ id: mod.id, kind: 'module', name: mod.name, path: mod.dir ?? undefined, metrics });
  }

  // 外部包节点与外部边
  const extImporters = new Map<string, Set<string>>();
  const externalEdges: GraphEdge[] = [];
  for (const e of allEdges) {
    if (!e.external) continue;
    const set = extImporters.get(e.to) ?? new Set<string>();
    set.add(e.from);
    extImporters.set(e.to, set);
    externalEdges.push(toGraphEdge(e));
  }
  const externalNodes: GraphNode[] = [...extImporters.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, importers]) => ({
      id: `ext:${pkg}`,
      kind: 'external' as const,
      name: pkg,
      metrics: {
        kind: 'file' as const,
        loc: 0,
        complexity: 0,
        fanIn: importers.size,
        fanOut: 0,
        health: 100,
      },
    }));

  const edges: GraphEdge[] = [...internalEdges.map(toGraphEdge), ...externalEdges];

  const violations = evaluateBoundaries({
    internalEdges,
    fileModule,
    moduleById,
    moduleMetrics,
    fileCycles,
    moduleCycles,
    rootModuleId: ROOT_MODULE_ID,
    config,
    misplaced,
    layering,
  });

  // 图情报趋势：承重墙 Top1（平局取路径较小者）与最大模块循环群规模
  const fileAnalytics = new Map<string, { pagerank: number; community: number }>();
  let topFile: { id: string; pagerank: number } | null = null;
  for (const path of [...files.keys()].sort()) {
    const pr = filePr?.get(path);
    const cm = fileCommunities?.labelOf.get(path);
    if (pr === undefined && cm === undefined) continue;
    const pr3 = pr !== undefined ? Math.round(pr * 1000) / 1000 : 0;
    fileAnalytics.set(path, { pagerank: pr3, community: cm ?? -1 });
    if (pr3 > 0 && (!topFile || pr3 > topFile.pagerank)) topFile = { id: path, pagerank: pr3 };
  }
  let largestModuleCycle = 0;
  for (const c of moduleCycles) if (c.length > largestModuleCycle) largestModuleCycle = c.length;

  return {
    nodes: [...moduleNodes, ...fileNodes, ...externalNodes],
    edges,
    violations,
    fileCycles,
    moduleCycles,
    moduleHealth: new Map([...moduleMetrics.entries()].map(([id, m]) => [id, m.health])),
    fileCount: files.size,
    fileAnalytics,
    graphTrends: { topFile, largestModuleCycle },
  };
}
