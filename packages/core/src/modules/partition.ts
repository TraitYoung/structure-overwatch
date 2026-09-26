import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ModuleDef {
  /** `module:<name>` */
  id: string;
  name: string;
  /** 仓库相对 posix 目录前缀；null 表示无固定目录（如散落文件的根模块） */
  dir: string | null;
}

export interface Partition {
  modules: ModuleDef[];
  moduleIdOf: (relPath: string) => string;
}

export const ROOT_MODULE_ID = 'module:(root)';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', '.turbo', '.output',
]);

interface WsPackage {
  name: string;
  /** 仓库相对 posix 目录 */
  dir: string;
}

/** 深度 ≤3 扫描 workspace 子包（含 package.json 且有 name 的目录） */
function detectWorkspacePackages(repoRoot: string): WsPackage[] {
  const found: WsPackage[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      const child = join(dir, ent.name);
      const pkgPath = join(child, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (typeof pkg.name === 'string' && pkg.name) {
            found.push({ name: pkg.name, dir: relative(repoRoot, child).split('\\').join('/') });
          }
        } catch {
          /* 无效 package.json，跳过 */
        }
      }
      walk(child, depth + 1);
    }
  };
  walk(repoRoot, 0);
  // 嵌套包按目录深度升序、路径排序，保证前缀匹配时优先命中更深的包
  return found.sort((a, b) => a.dir.split('/').length - b.dir.split('/').length || a.dir.localeCompare(b.dir));
}

/**
 * 模块（省份）划分：
 * - monorepo（检测到 workspace 子包）：每个子包一个模块，包外文件归入根模块；
 * - 有 src/：src/<dir>/** 归模块 <dir>，其余归根模块；
 * - 无 src/：<dir>/** 归模块 <dir>，顶层文件归根模块。
 */
export function computePartition(repoRoot: string, sourcePaths: readonly string[]): Partition {
  const workspaces = detectWorkspacePackages(repoRoot);
  const modules = new Map<string, ModuleDef>();

  if (workspaces.length > 0) {
    for (const ws of workspaces) {
      modules.set(`module:${ws.name}`, { id: `module:${ws.name}`, name: ws.name, dir: ws.dir });
    }
  } else {
    const hasSrc = existsSync(join(repoRoot, 'src'));
    for (const p of sourcePaths) {
      const segs = p.split('/');
      let dirPrefix: string | null = null;
      if (hasSrc) {
        if (segs[0] === 'src' && segs.length >= 3) dirPrefix = `src/${segs[1]}`;
      } else if (segs.length >= 2) {
        dirPrefix = segs[0];
      }
      if (dirPrefix) {
        const name = dirPrefix.split('/').pop()!;
        if (!modules.has(`module:${name}`)) {
          modules.set(`module:${name}`, { id: `module:${name}`, name, dir: dirPrefix });
        }
      }
    }
  }

  const wsSorted = [...modules.values()].sort((a, b) => (b.dir?.length ?? 0) - (a.dir?.length ?? 0));

  const moduleIdOf = (relPath: string): string => {
    if (workspaces.length > 0) {
      for (const m of wsSorted) {
        if (m.dir && (relPath === m.dir || relPath.startsWith(`${m.dir}/`))) return m.id;
      }
      return ROOT_MODULE_ID;
    }
    const segs = relPath.split('/');
    const hasSrc = existsSync(join(repoRoot, 'src'));
    if (hasSrc) {
      if (segs[0] === 'src' && segs.length >= 3) return `module:${segs[1]}`;
    } else if (segs.length >= 2) {
      return `module:${segs[0]}`;
    }
    return ROOT_MODULE_ID;
  };

  // 只保留实际有文件的模块；根模块有文件时保留
  const used = new Set(sourcePaths.map(moduleIdOf));
  const result = [...modules.values()].filter((m) => used.has(m.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (used.has(ROOT_MODULE_ID)) {
    result.push({ id: ROOT_MODULE_ID, name: '(root)', dir: null });
  }
  return { modules: result, moduleIdOf };
}
