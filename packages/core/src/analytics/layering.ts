// 依赖分层：模块图 SCC 缩点 → 拓扑最长路径分层。
// 循环环缩成一个点后系统必成 DAG；level 0 = 无跨模块入边的顶层消费者，
// 层数越大越基础（被依赖越深）。依赖应自上而下流动（小层 → 大层）。

import { stronglyConnectedComponents } from '../graph/scc.js';

export interface SkipLayerEdge {
  from: string;
  to: string;
  fromLayer: number;
  toLayer: number;
  /** 聚合权重（文件边数） */
  weight: number;
}

export interface LayeringResult {
  /** 模块 → 层号（0=顶层消费者；同一 SCC 的模块共享层号） */
  layerOfModule: Map<string, number>;
  /** 总层数 */
  layerCount: number;
  /** ≥3 个模块构成的循环群（熔炉） */
  megaCycles: string[][];
  /** 跨层直连（层差 ≥2）的模块边 */
  skipLayerEdges: SkipLayerEdge[];
}

export function computeLayering(
  moduleAdj: ReadonlyMap<string, readonly string[]>,
  moduleEdgeWeight: ReadonlyMap<string, { from: string; to: string; weight: number }>,
  allModuleIds: readonly string[],
): LayeringResult {
  const components = stronglyConnectedComponents(moduleAdj);
  const compOf = new Map<string, number>();
  components.forEach((comp, ci) => {
    for (const m of comp) compOf.set(m, ci);
  });
  for (const m of allModuleIds) if (!compOf.has(m)) compOf.set(m, -1);

  // 缩点图的边集与入度
  const condensed = new Map<number, Set<number>>();
  const indeg = new Map<number, number>();
  const ensure = (ci: number) => {
    if (!condensed.has(ci)) {
      condensed.set(ci, new Set());
      indeg.set(ci, 0);
    }
  };
  for (const [from, list] of moduleAdj) {
    const cf = compOf.get(from);
    if (cf === undefined || cf < 0) continue;
    ensure(cf);
    for (const to of list) {
      const ct = compOf.get(to);
      if (ct === undefined || ct < 0 || ct === cf) continue;
      ensure(ct);
      const set = condensed.get(cf)!;
      if (!set.has(ct)) {
        set.add(ct);
        indeg.set(ct, (indeg.get(ct) ?? 0) + 1);
      }
    }
  }
  for (const ci of allModuleIds.map((m) => compOf.get(m)!).filter((ci) => ci >= 0)) ensure(ci);

  // Kahn 拓扑 + 最长路径：layer(c) = 1 + max(layer(前驱))，无入度为 0
  const layer = new Map<number, number>();
  const queue: number[] = [];
  for (const [ci, d] of indeg) {
    if (d === 0) {
      layer.set(ci, 0);
      queue.push(ci);
    }
  }
  queue.sort((a, b) => a - b);
  let head = 0;
  while (head < queue.length) {
    const ci = queue[head++];
    for (const cj of [...condensed.get(ci)!].sort((a, b) => a - b)) {
      const cand = layer.get(ci)! + 1;
      if (cand > (layer.get(cj) ?? 0)) layer.set(cj, cand);
      const d = indeg.get(cj)! - 1;
      indeg.set(cj, d);
      if (d === 0) queue.push(cj);
    }
  }

  const layerOfModule = new Map<string, number>();
  let layerCount = 0;
  for (const m of allModuleIds) {
    const ci = compOf.get(m);
    if (ci === undefined || ci < 0) {
      layerOfModule.set(m, 0); // 无任何边的模块放在顶层
      if (layerCount < 1) layerCount = 1;
    } else {
      const l = layer.get(ci) ?? 0;
      layerOfModule.set(m, l);
      if (l + 1 > layerCount) layerCount = l + 1;
    }
  }

  const megaCycles = components.filter((c) => c.length >= 3).map((c) => [...c].sort());
  const skipLayerEdges: SkipLayerEdge[] = [];
  for (const { from, to, weight } of moduleEdgeWeight.values()) {
    const lf = layerOfModule.get(from);
    const lt = layerOfModule.get(to);
    if (lf === undefined || lt === undefined) continue;
    if (lt - lf < 2) continue;
    skipLayerEdges.push({ from, to, fromLayer: lf, toLayer: lt, weight });
  }
  skipLayerEdges.sort((a, b) => b.toLayer - b.fromLayer - (a.toLayer - a.fromLayer) || a.from.localeCompare(b.from));

  return { layerOfModule, layerCount, megaCycles, skipLayerEdges };
}
