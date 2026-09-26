/** 迭代式 Tarjan 强连通分量；输入邻接表（子节点顺序决定输出顺序，需由调用方保证确定性） */
export function stronglyConnectedComponents(adj: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const start of adj.keys()) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    const call: Array<[string, number]> = [[start, 0]];

    while (call.length > 0) {
      const frame = call[call.length - 1];
      const [v, childIdx] = frame;
      const children = adj.get(v) ?? [];
      if (childIdx < children.length) {
        frame[1] = childIdx + 1;
        const w = children[childIdx];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          call.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      } else {
        call.pop();
        if (call.length > 0) {
          const parent = call[call.length - 1][0];
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
        if (low.get(v) === index.get(v)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          result.push(comp);
        }
      }
    }
  }
  return result;
}

/** 过滤出真正的环：大小 >1 或存在自环 */
export function cycleComponents(sccs: readonly string[][], adj: ReadonlyMap<string, readonly string[]>): string[][] {
  return sccs.filter((c) => {
    if (c.length > 1) return true;
    const self = adj.get(c[0])?.includes(c[0]);
    return self === true;
  });
}
