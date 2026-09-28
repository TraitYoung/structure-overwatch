// 社区检测：label propagation 跑在内部依赖边的无向投影上。
// 确定性保证：节点按 id 排序、平局取字典序最小标签、每轮轮转处理起点
// （轮转打破高度对称图上的标签震荡，异步更新避免桥节点级联合并）。
// 投票按邻居度数归一化（1/deg）：防止高扇入枢纽把全图吸进一个社区。

import type { FileEdge } from '../graph/worldGraph.js';

export interface CommunityResult {
  /** 有内部边的文件 → 社区编号（0..k-1）；无边文件不出现 */
  labelOf: Map<string, number>;
  /** 社区编号 → 成员（排序） */
  communities: string[][];
}

/** label propagation：adj 为有向出边表，按无向处理 */
export function detectCommunities(adj: ReadonlyMap<string, readonly string[]>, maxPasses = 8): CommunityResult {
  // 无向邻接（去重）
  const nbrs = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = nbrs.get(a) ?? new Set<string>();
    set.add(b);
    nbrs.set(a, set);
  };
  for (const [from, list] of adj) {
    for (const to of list) {
      if (from === to) continue;
      add(from, to);
      add(to, from);
    }
  }

  const nodes = [...nbrs.keys()].sort();
  const label = new Map<string, string>(nodes.map((n) => [n, n]));

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[(i + pass) % nodes.length]; // 轮转起点，打破对称图上的标签震荡
      const counts = new Map<string, number>();
      for (const nbr of [...nbrs.get(n)!].sort()) {
        const l = label.get(nbr); // 异步更新：读当前标签
        if (l === undefined) continue;
        const w = 1 / nbrs.get(nbr)!.size;
        counts.set(l, (counts.get(l) ?? 0) + w);
      }
      if (counts.size === 0) continue;
      let bestLabel = '';
      let bestCount = 0;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < bestLabel)) {
          bestLabel = l;
          bestCount = c;
        }
      }
      if (bestLabel !== label.get(n)) {
        label.set(n, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 标签压缩为 0..k-1 编号（按标签排序，保证稳定）
  const labels = [...new Set(label.values())].sort();
  const labelIndex = new Map(labels.map((l, i) => [l, i]));
  const labelOf = new Map<string, number>();
  const communities: string[][] = labels.map(() => []);
  for (const n of nodes) {
    const idx = labelIndex.get(label.get(n)!)!;
    labelOf.set(n, idx);
    communities[idx].push(n);
  }
  for (const c of communities) c.sort();
  return { labelOf, communities };
}

export interface MisplacedGroup {
  /** 文件当前所属模块 */
  fromModule: string;
  /** 社区主导模块（建议迁入） */
  toModule: string;
  files: string[];
}

export interface MisplacedOptions {
  /** 社区最小规模（小于此规模不产生建议），默认 3 */
  minCommunitySize?: number;
  /** 文件与社区成员的最少连边数（防噪），默认 2 */
  minInCommunityEdges?: number;
  /** 每组最少错位文件数（单文件不搬），默认 2 */
  minGroupFiles?: number;
  /** 社区占全仓文件比例超过该值视为巨石社区，不产生建议，默认 0.5 */
  maxCommunityShare?: number;
}

/**
 * 找出错位文件：社区规模足够大时，把「实际耦合在别的省份群落」的文件按
 * (当前模块 → 主导模块) 分组。门槛用于防止小簇噪声与巨石社区误报
 * （整个仓库缠成一团时社区检测本就没有边界信号，不产生迁移建议）。
 */
export function findMisplacedGroups(
  communities: readonly (readonly string[])[],
  fileModule: ReadonlyMap<string, string>,
  internalEdges: readonly FileEdge[],
  options: MisplacedOptions = {},
): MisplacedGroup[] {
  const { minCommunitySize = 3, minInCommunityEdges = 2, minGroupFiles = 2, maxCommunityShare = 0.5 } = options;
  const edgedFiles = new Set<string>();
  for (const members of communities) for (const f of members) edgedFiles.add(f);
  const groups = new Map<string, MisplacedGroup>();

  for (const members of communities) {
    if (members.length < minCommunitySize) continue;
    if (edgedFiles.size > 0 && members.length / edgedFiles.size > maxCommunityShare) continue; // 巨石社区
    const memberSet = new Set(members);

    // 主导模块 = 成员所属模块的众数（平局取模块 id 较小者）
    const moduleCount = new Map<string, number>();
    for (const f of members) {
      const m = fileModule.get(f);
      if (!m) continue;
      moduleCount.set(m, (moduleCount.get(m) ?? 0) + 1);
    }
    let dominant = '';
    let dominantCount = 0;
    for (const [m, c] of [...moduleCount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (c > dominantCount) {
        dominant = m;
        dominantCount = c;
      }
    }
    if (!dominant) continue;

    // 每个成员与社区内部的无向连边数
    const innerEdges = new Map<string, number>();
    for (const e of internalEdges) {
      if (!memberSet.has(e.from) || !memberSet.has(e.to) || e.from === e.to) continue;
      innerEdges.set(e.from, (innerEdges.get(e.from) ?? 0) + 1);
      innerEdges.set(e.to, (innerEdges.get(e.to) ?? 0) + 1);
    }

    for (const f of members) {
      const m = fileModule.get(f);
      if (!m || m === dominant) continue;
      if ((innerEdges.get(f) ?? 0) < minInCommunityEdges) continue;
      const key = `${m}|${dominant}`;
      const g = groups.get(key) ?? { fromModule: m, toModule: dominant, files: [] };
      g.files.push(f);
      groups.set(key, g);
    }
  }

  for (const g of groups.values()) g.files.sort();
  return [...groups.values()]
    .filter((g) => g.files.length >= minGroupFiles)
    .sort((a, b) => a.fromModule.localeCompare(b.fromModule) || a.toModule.localeCompare(b.toModule));
}
