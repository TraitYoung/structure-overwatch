#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startServer } from './index.js';

interface CliArgs {
  target: string | null;
  port: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { target: null, port: 3210 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.port = Math.floor(n);
        i += 1;
      }
      continue;
    }
    if (a === 'watch') continue;
    if (!a.startsWith('-')) args.target = a;
  }
  return args;
}

function printBanner(repoRoot: string, port: number, wsTargetIncluded: boolean): void {
  const lines = [
    '',
    '  ┌─────────────────────────────────────────────┐',
    '  │   S T R U C T U R E   S U R V A L L I A N   │',
    '  │   架构哨站 · 实时监控目标仓库的架构地图      │',
    '  └─────────────────────────────────────────────┘',
    '',
    `  监控目标   ${repoRoot}`,
    `  地图界面   http://127.0.0.1:${port}/`,
    `  快照接口   http://127.0.0.1:${port}/api/snapshot`,
    `  事件流     ws://127.0.0.1:${port}/ws`,
    ...(wsTargetIncluded ? [] : []),
    '',
    '  Ctrl+C 退出',
    '',
  ];
  console.log(lines.join('\n'));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let target = args.target;
  if (!target) {
    // 开发环境默认指向本仓库自带的演示仓库
    const demo = fileURLToPath(new URL('../../../fixtures/demo-repo', import.meta.url));
    target = existsSync(demo) ? demo : process.cwd();
  }
  const repoRoot = resolve(target);

  if (!existsSync(repoRoot)) {
    console.error(`目标目录不存在：${repoRoot}`);
    process.exit(1);
  }

  const { port } = await startServer({
    repoRoot,
    port: args.port,
    webDist: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  });
  printBanner(repoRoot, port, false);

  const shutdown = async () => {
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
