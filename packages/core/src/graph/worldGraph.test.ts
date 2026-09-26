import { describe, expect, it } from 'vitest';
import { WorldGraph } from './worldGraph.js';

describe('WorldGraph', () => {
  it('同目标导入去重：值导入优先于 type-import，外部边独立', () => {
    const g = new WorldGraph();
    const delta = g.upsertFile({
      path: 'src/a.ts',
      loc: 10,
      complexity: 1,
      imports: [
        { to: 'src/b.ts', kind: 'type-import', external: false },
        { to: 'src/b.ts', kind: 'import', external: false },
        { to: 'zod', kind: 'external', external: true },
      ],
    });
    expect(delta.added).toHaveLength(2);
    expect(g.fileEdges().map((e) => [e.from, e.to, e.kind, e.external])).toContainEqual([
      'src/a.ts',
      'src/b.ts',
      'import',
      false,
    ]);
    expect(g.fileEdges().map((e) => [e.from, e.to])).toContainEqual(['src/a.ts', 'zod']);
  });

  it('upsert 产生正确的边差分', () => {
    const g = new WorldGraph();
    g.upsertFile({ path: 'src/a.ts', loc: 1, complexity: 1, imports: [{ to: 'src/b.ts', kind: 'import', external: false }] });
    const delta = g.upsertFile({
      path: 'src/a.ts',
      loc: 2,
      complexity: 1,
      imports: [{ to: 'src/c.ts', kind: 'import', external: false }],
    });
    expect(delta.added.map((e) => e.to)).toEqual(['src/c.ts']);
    expect(delta.removed.map((e) => e.to)).toEqual(['src/b.ts']);
  });

  it('removeFile 返回被移除的边', () => {
    const g = new WorldGraph();
    g.upsertFile({ path: 'src/a.ts', loc: 1, complexity: 1, imports: [{ to: 'src/b.ts', kind: 'import', external: false }] });
    g.upsertFile({ path: 'src/b.ts', loc: 1, complexity: 1, imports: [] });
    const delta = g.removeFile('src/a.ts');
    expect(delta!.removed.map((e) => e.to)).toEqual(['src/b.ts']);
    expect(g.allFiles().has('src/a.ts')).toBe(false);
  });
});
