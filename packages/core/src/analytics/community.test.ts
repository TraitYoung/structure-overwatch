import { describe, expect, it } from 'vitest';
import { detectCommunities, findMisplacedGroups } from './community.js';
import type { FileEdge } from '../graph/worldGraph.js';

function edge(from: string, to: string): FileEdge {
  return { from, to, external: false, kind: 'import' };
}

describe('detectCommunities', () => {
  it('两个稠密簇 + 单桥：不合并', () => {
    const adj = new Map<string, string[]>([
      ['a1', ['a2', 'a3']],
      ['a2', ['a1', 'a3']],
      ['a3', ['a1', 'a2', 'b1']], // 簇内两条 + 唯一的桥
      ['b1', ['b2', 'b3']],
      ['b2', ['b1', 'b3']],
      ['b3', ['b1', 'b2']],
    ]);
    const { labelOf, communities } = detectCommunities(adj);
    expect(communities).toHaveLength(2);
    const a = communities.find((c) => c.includes('a1'))!;
    const b = communities.find((c) => c.includes('b1'))!;
    expect([...a].sort()).toEqual(['a1', 'a2', 'a3']);
    expect([...b].sort()).toEqual(['b1', 'b2', 'b3']);
    expect(labelOf.get('a1')).toBe(labelOf.get('a2'));
    expect(labelOf.get('a1')).not.toBe(labelOf.get('b1'));
  });

  it('结果确定：重复计算标签一致', () => {
    const adj = new Map<string, string[]>([
      ['x', ['y']],
      ['y', ['x', 'z']],
      ['z', ['y', 'w']],
      ['w', ['z']],
    ]);
    const r1 = detectCommunities(adj);
    const r2 = detectCommunities(adj);
    expect([...r1.labelOf.entries()]).toEqual([...r2.labelOf.entries()]);
  });
});

describe('findMisplacedGroups', () => {
  it('少数派成员归属多数派模块时产出迁移建议', () => {
    // 社区：f1,f2 ∈ mA，g1,g2 ∈ mB，稠密互连；另有两组独立填充对，
    // 保证目标社区占比不超过巨石社区阈值（50%）
    const adj = new Map<string, string[]>([
      ['f1', ['f2', 'g1', 'g2']],
      ['f2', ['f1', 'g1', 'g2']],
      ['g1', ['f1', 'f2']],
      ['g2', ['f1', 'f2']],
      ['h1', ['h2']],
      ['h2', ['h1']],
      ['k1', ['k2']],
      ['k2', ['k1']],
    ]);
    const { communities } = detectCommunities(adj);
    const fileModule = new Map<string, string>([
      ['f1', 'module:a'], ['f2', 'module:a'],
      ['g1', 'module:b'], ['g2', 'module:b'],
      ['h1', 'module:a'], ['h2', 'module:a'],
      ['k1', 'module:b'], ['k2', 'module:b'],
    ]);
    const edges = [
      edge('f1', 'f2'), edge('f2', 'f1'), edge('g1', 'f1'), edge('g1', 'f2'),
      edge('g2', 'f1'), edge('g2', 'f2'), edge('h1', 'h2'), edge('h2', 'h1'),
      edge('k1', 'k2'), edge('k2', 'k1'),
    ];
    const groups = findMisplacedGroups(communities, fileModule, edges);
    expect(groups).toHaveLength(1);
    expect(groups[0].fromModule).toBe('module:b');
    expect(groups[0].toModule).toBe('module:a');
    expect([...groups[0].files].sort()).toEqual(['g1', 'g2']);
  });

  it('巨石社区（占比过半）不产生建议', () => {
    // 整个图就是一个社区：社区检测没有边界信号，不应产出迁移建议
    const adj = new Map<string, string[]>([
      ['f1', ['f2', 'g1']],
      ['f2', ['f3', 'g1', 'g2']],
      ['f3', ['f1', 'g2']],
      ['g1', ['f1', 'f2']],
      ['g2', ['f2', 'f3']],
    ]);
    const { communities } = detectCommunities(adj);
    expect(communities).toHaveLength(1);
    const fileModule = new Map<string, string>([
      ['f1', 'module:a'], ['f2', 'module:a'], ['f3', 'module:a'],
      ['g1', 'module:b'], ['g2', 'module:b'],
    ]);
    const edges = [
      edge('f1', 'f2'), edge('f1', 'g1'), edge('f2', 'f3'), edge('f2', 'g1'), edge('f2', 'g2'),
      edge('f3', 'f1'), edge('f3', 'g2'), edge('g1', 'f1'), edge('g1', 'f2'), edge('g2', 'f2'), edge('g2', 'f3'),
    ];
    expect(findMisplacedGroups(communities, fileModule, edges)).toHaveLength(0);
  });

  it('小社区（<3 文件）不产生建议（防噪）', () => {
    const adj = new Map<string, string[]>([
      ['f1', ['g1']],
      ['g1', ['f1']],
    ]);
    const { communities } = detectCommunities(adj);
    const fileModule = new Map<string, string>([['f1', 'module:a'], ['g1', 'module:b']]);
    expect(findMisplacedGroups(communities, fileModule, [edge('f1', 'g1'), edge('g1', 'f1')])).toHaveLength(0);
  });
});
