/** 文件健康度：复杂度、循环依赖、体量惩罚，下限 5 */
export function fileHealth(loc: number, complexity: number, inCycle: boolean): number {
  let h = 100;
  if (complexity > 10) h -= Math.min(40, (complexity - 10) * 2);
  if (inCycle) h -= 25;
  if (loc > 400) h -= 10;
  if (loc > 1000) h -= 10;
  return Math.max(5, Math.round(h));
}

export function clampHealth(h: number): number {
  return Math.max(0, Math.min(100, Math.round(h)));
}
