import { describe, expect, it } from 'vitest';
import { computeLayering } from './layering.js';

const UI = 'module:ui';
const SERVICES = 'module:services';
const DOMAIN = 'module:domain';
const UTILS = 'module:utils';

function weights(list: Array<[string, string, number]>): Map<string, { from: string; to: string; weight: number }> {
  return new Map(list.map(([from, to, weight]) => [`${from}|${to}`, { from, to, weight }]));
}

describe('computeLayering', () => {
  it('无环链：消费者在第 0 层，基础层最深', () => {
    const adj = new Map<string, string[]>([
      [UI, [SERVICES]],
      [SERVICES, [DOMAIN]],
      [DOMAIN, [UTILS]],
      [UTILS, []],
    ]);
    const res = computeLayering(adj, weights([[UI, SERVICES, 1], [SERVICES, DOMAIN, 1], [DOMAIN, UTILS, 1]]), [
      UI, SERVICES, DOMAIN, UTILS,
    ]);
    expect(res.layerOfModule.get(UI)).toBe(0);
    expect(res.layerOfModule.get(SERVICES)).toBe(1);
    expect(res.layerOfModule.get(DOMAIN)).toBe(2);
    expect(res.layerOfModule.get(UTILS)).toBe(3);
    expect(res.layerCount).toBe(4);
    expect(res.megaCycles).toHaveLength(0);
    expect(res.skipLayerEdges).toHaveLength(0);
  });

  it('跨层直连被识别', () => {
    const adj = new Map<string, string[]>([
      [UI, [SERVICES, DOMAIN]],
      [SERVICES, [DOMAIN]],
      [DOMAIN, []],
    ]);
    const res = computeLayering(adj, weights([[UI, SERVICES, 1], [SERVICES, DOMAIN, 1], [UI, DOMAIN, 2]]), [
      UI, SERVICES, DOMAIN,
    ]);
    expect(res.layerOfModule.get(DOMAIN)).toBe(2);
    expect(res.skipLayerEdges).toHaveLength(1);
    expect(res.skipLayerEdges[0].from).toBe(UI);
    expect(res.skipLayerEdges[0].to).toBe(DOMAIN);
    expect(res.skipLayerEdges[0].weight).toBe(2);
  });

  it('三模块环缩成一个熔炉，共享层号', () => {
    const adj = new Map<string, string[]>([
      [SERVICES, [DOMAIN]],
      [DOMAIN, [UTILS]],
      [UTILS, [SERVICES]],
    ]);
    const res = computeLayering(adj, weights([[SERVICES, DOMAIN, 1], [DOMAIN, UTILS, 1], [UTILS, SERVICES, 1]]), [
      SERVICES, DOMAIN, UTILS,
    ]);
    expect(res.megaCycles).toHaveLength(1);
    expect([...res.megaCycles[0]].sort()).toEqual([DOMAIN, SERVICES, UTILS].sort());
    const l = res.layerOfModule.get(SERVICES);
    expect(res.layerOfModule.get(DOMAIN)).toBe(l);
    expect(res.layerOfModule.get(UTILS)).toBe(l);
    expect(res.layerCount).toBe(1);
  });

  it('孤立模块放在第 0 层', () => {
    const res = computeLayering(new Map(), new Map(), ['module:alone']);
    expect(res.layerOfModule.get('module:alone')).toBe(0);
    expect(res.layerCount).toBe(1); // 仅孤立层
  });
});
