import { describe, expect, it } from 'vitest';
import { cycleComponents, stronglyConnectedComponents } from './scc.js';

describe('stronglyConnectedComponents', () => {
  it('识别双向环、独立节点与自环', () => {
    const adj = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['d']],
      ['d', []],
      ['e', ['e']],
    ]);
    const sccs = stronglyConnectedComponents(adj);
    const cycles = cycleComponents(sccs, adj);
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => [...c].sort())).toContainEqual(['a', 'b']);
    expect(cycles.map((c) => [...c].sort())).toContainEqual(['e']);
  });

  it('长链无环', () => {
    const adj = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    expect(cycleComponents(stronglyConnectedComponents(adj), adj)).toHaveLength(0);
  });

  it('三节点环', () => {
    const adj = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = cycleComponents(stronglyConnectedComponents(adj), adj);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]].sort()).toEqual(['a', 'b', 'c']);
  });
});
