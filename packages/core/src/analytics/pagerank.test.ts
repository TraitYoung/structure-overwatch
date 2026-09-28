import { describe, expect, it } from 'vitest';
import { pageRank } from './pagerank.js';

describe('pageRank', () => {
  it('星型图：中心节点最重要，叶子等权', () => {
    const adj = new Map<string, string[]>([
      ['a', ['c']],
      ['b', ['c']],
      ['d', ['c']],
    ]);
    const rank = pageRank(adj);
    expect(rank.get('c')).toBe(1); // 归一化后最大者为 1
    expect(rank.get('a')).toBe(rank.get('b'));
    expect(rank.get('a')).toBe(rank.get('d'));
    expect(rank.get('a')!).toBeLessThan(rank.get('c')!);
  });

  it('传递依赖：经枢纽被导入的文件比孤立被导入者更重要', () => {
    // hub 被 a/b/c 三个文件导入，base 只被 hub 导入；leaf 只被 x 一次导入。
    // hub 的入边来源（a/b/c）自身几乎无人引用，因此最高分落在 base——
    // 这正是 PageRank 的传递性：承重墙引用的文件同样承重。
    const adj = new Map<string, string[]>([
      ['a', ['hub']],
      ['b', ['hub']],
      ['c', ['hub']],
      ['hub', ['base']],
      ['x', ['leaf']],
    ]);
    const rank = pageRank(adj);
    expect(rank.get('base')).toBe(1);
    expect(rank.get('base')!).toBeGreaterThan(rank.get('leaf')!);
    expect(rank.get('hub')!).toBeGreaterThan(rank.get('a')!);
  });

  it('空图返回空结果', () => {
    expect(pageRank(new Map()).size).toBe(0);
  });

  it('结果确定（重复计算一致）且均在 (0,1]', () => {
    const adj = new Map<string, string[]>([
      ['a', ['b', 'c']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const r1 = pageRank(adj);
    const r2 = pageRank(adj);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
    for (const v of r1.values()) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
