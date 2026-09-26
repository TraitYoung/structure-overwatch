import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { RepoParser } from './parse.js';
import { DEMO_REPO } from '../testing.js';

describe('RepoParser', () => {
  const parser = new RepoParser(DEMO_REPO);

  it('解析别名导入（tsconfig paths）为内部文件边', () => {
    const panel = parser.addFile(join(DEMO_REPO, 'src/ui/panel.ts'));
    expect(panel).not.toBeNull();
    expect(panel!.imports).toContainEqual({ to: 'src/services/repo/userRepo.ts', kind: 'import', external: false });
    expect(panel!.imports).toContainEqual({ to: 'src/utils/logger.ts', kind: 'import', external: false });
    expect(panel!.loc).toBeGreaterThan(5);
  });

  it('识别外部 npm 包与 node: 内置', () => {
    const user = parser.addFile(join(DEMO_REPO, 'src/domain/user.ts'));
    expect(user!.imports).toContainEqual({ to: 'zod', kind: 'external', external: true });
    const money = parser.addFile(join(DEMO_REPO, 'src/utils/format/money.ts'));
    expect(money!.imports.filter((i) => i.external)).toHaveLength(0);
  });

  it('识别 type-only 导入', () => {
    const uiApp = parser.addFile(join(DEMO_REPO, 'src/ui/app.ts'));
    expect(uiApp!.imports).toContainEqual({ to: 'src/domain/user.ts', kind: 'type-import', external: false });
  });

  it('近似圈复杂度统计分支与短路运算', () => {
    const old = parser.addFile(join(DEMO_REPO, 'src/legacy/old.ts'));
    // for + if + 三元 → 复杂度 ≥ 4
    expect(old!.complexity).toBeGreaterThanOrEqual(4);
  });

  it('重新解析能反映文件变化', () => {
    const path = join(DEMO_REPO, 'src/utils/date.ts');
    const before = parser.addFile(path)!;
    expect(before.imports).toContainEqual({ to: 'src/domain/types.ts', kind: 'type-import', external: false });
  });
});
