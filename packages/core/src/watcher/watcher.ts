import chokidar from 'chokidar';

const IGNORED_DIR_RE = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.next|\.cache|\.turbo|\.output|\.vite)(\/|$)/;

export interface FsEvent {
  type: 'add' | 'change' | 'unlink';
  absPath: string;
}

export interface WatcherHandle {
  ready: Promise<void>;
  close: () => Promise<void>;
}

/**
 * 监听目标仓库的文件增删改，按 batchMs 防抖合批回调。
 * 目录忽略在 watcher 层做（避免目录被误判为文件而剪枝），扩展名过滤由 engine 负责。
 */
export function startWatcher(repoRoot: string, onBatch: (events: FsEvent[]) => void, batchMs = 300, onError?: (error: unknown) => void): WatcherHandle {
  let pending: FsEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const flush = () => {
    const batch = pending;
    pending = [];
    timer = null;
    if (batch.length > 0) onBatch(batch);
  };

  const queue = (type: FsEvent['type'], absPath: string) => {
    if (closed) return;
    pending.push({ type, absPath });
    if (!timer) timer = setTimeout(flush, batchMs);
  };

  const watcher = chokidar.watch(repoRoot, {
    ignoreInitial: true,
    ignored: (path: string) => IGNORED_DIR_RE.test(path.replace(/\\/g, '/')),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on('add', (p) => queue('add', p));
  watcher.on('change', (p) => queue('change', p));
  watcher.on('unlink', (p) => queue('unlink', p));
  watcher.on('error', (error) => onError?.(error));
  const ready = new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve);
    watcher.once('error', reject);
  });

  return {
    ready,
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      pending = [];
      await watcher.close();
    },
  };
}
