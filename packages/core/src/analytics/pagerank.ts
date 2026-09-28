// PageRank：结构重要性沿依赖方向传播（importer → importee，被依赖者吸收重要度）。
// 与 fan-in 的区别在于捕捉传递依赖：一个只被承重墙引用的文件同样重要。

export interface PageRankOptions {
  /** 阻尼系数，默认 0.85 */
  damping?: number;
  /** 最大迭代轮数，默认 15 */
  maxIterations?: number;
  /** L1 收敛阈值，默认 1e-4 */
  tolerance?: number;
}

/**
 * 计算有向图的 PageRank。adj 为出边邻接表（排序与否均可，结果确定）。
 * 孤立点（不出现在任何边中）不参与计算。结果归一化到 max=1，保留 4 位小数。
 */
export function pageRank(
  adj: ReadonlyMap<string, readonly string[]>,
  options: PageRankOptions = {},
): Map<string, number> {
  const { damping = 0.85, maxIterations = 15, tolerance = 1e-4 } = options;

  // 节点集合 = 源点 ∪ 目标点，排序保证确定性
  const nodeSet = new Set<string>(adj.keys());
  for (const list of adj.values()) for (const t of list) nodeSet.add(t);
  const nodes = [...nodeSet].sort();
  const n = nodes.length;
  if (n === 0) return new Map();

  const index = new Map(nodes.map((id, i) => [id, i]));
  const out: number[] = new Array(n).fill(0);
  const targets: number[][] = Array.from({ length: n }, () => []);
  for (const [from, list] of adj) {
    const fi = index.get(from)!;
    for (const to of list) {
      const ti = index.get(to);
      if (ti === undefined) continue;
      targets[fi].push(ti);
      out[fi] += 1;
    }
  }
  let rank = new Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIterations; iter++) {
    let dangling = 0; // 出度为 0 的节点把重要度均分给所有人
    for (let i = 0; i < n; i++) if (out[i] === 0) dangling += rank[i];
    const base = (1 - damping) / n + (damping * dangling) / n;
    const next = new Array(n).fill(base);
    for (let i = 0; i < n; i++) {
      if (out[i] === 0 || rank[i] === 0) continue;
      const share = (damping * rank[i]) / out[i];
      for (const t of targets[i]) next[t] += share;
    }
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - rank[i]);
    rank = next;
    if (delta < tolerance) break;
  }

  let max = 0;
  for (const r of rank) if (r > max) max = r;
  const scale = max > 0 ? 1 / max : 0;
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) result.set(nodes[i], Math.round(rank[i] * scale * 1e4) / 1e4);
  return result;
}
