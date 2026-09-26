// 无人引用的遗留代码：制造“孤岛模块”
export function oldLogic(input: number): number {
  let acc = 0;
  for (let i = 0; i < input; i++) {
    if (i % 7 === 0) {
      acc -= i;
      continue;
    }
    acc += i % 3 === 0 ? i * 2 : i;
  }
  return acc;
}
