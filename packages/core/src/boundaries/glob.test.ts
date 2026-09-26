import { describe, expect, it } from 'vitest';
import { matchGlob } from './glob.js';

describe('matchGlob', () => {
  it('** 匹配多层目录', () => {
    expect(matchGlob('**/utils/**', 'src/utils/date.ts')).toBe(true);
    expect(matchGlob('**/utils/**', 'a/b/utils/c/d.ts')).toBe(true);
    expect(matchGlob('**/utils/**', 'src/utilsX/date.ts')).toBe(false);
  });

  it('前缀目录精确匹配', () => {
    expect(matchGlob('src/ui/**', 'src/ui/panel.ts')).toBe(true);
    expect(matchGlob('src/ui/**', 'src/uid/panel.ts')).toBe(false);
    expect(matchGlob('src/ui/**', 'src/ui.ts')).toBe(false);
  });

  it('* 不跨目录', () => {
    expect(matchGlob('*.ts', 'a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'b/a.ts')).toBe(false);
    expect(matchGlob('src/*.test.ts', 'src/a.test.ts')).toBe(true);
  });
});
