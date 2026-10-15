import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AnalysisEngine, startWatcher, type FsEvent, type WatcherHandle } from '@surv/core';
import type { DirectoryListing, LocalProject, ProjectList, ProjectSnapshot, ServerMessage, WorldDiff } from '@surv/shared';

export class ProjectError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export async function validateDirectory(input: string): Promise<string> {
  if (!input || !isAbsolute(input) || input.includes('\0')) throw new ProjectError('请输入项目文件夹的绝对路径。');
  try {
    const path = await realpath(input);
    if (!(await stat(path)).isDirectory()) throw new ProjectError('所选路径不是文件夹。');
    await access(path, constants.R_OK);
    await readdir(path);
    return path;
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new ProjectError(code === 'ENOENT' ? '文件夹不存在，可能已被移动或删除。' : '无法读取此文件夹，请检查访问权限。');
  }
}

export async function listDirectories(input?: string): Promise<DirectoryListing> {
  const path = await validateDirectory(input ?? homedir());
  const directories = (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const roots = process.platform === 'win32'
    ? (await Promise.all(Array.from({ length: 26 }, async (_, i) => {
      const drive = `${String.fromCharCode(65 + i)}:\\`;
      return await access(drive).then(() => drive, () => null);
    }))).filter((drive): drive is string => drive !== null)
    : ['/'];
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, directories, roots };
}

interface Session {
  id: string;
  engine: AnalysisEngine;
  watcher?: WatcherHandle;
  detach: () => void;
}

/** A single shared live project. Switches are serialized; failed validation preserves the current project. */
export class ProjectManager extends EventEmitter {
  private session: Session | null = null;
  private recent: LocalProject[] = [];
  private transition: Promise<unknown> = Promise.resolve();
  private closed = false;
  private historyWarning?: string;
  private readonly historyFile: string | false;

  constructor(private readonly options: { watch?: boolean; projectsFile?: string | false } = {}) {
    super();
    this.historyFile = options.projectsFile ?? resolve(process.cwd(), '.survallian/projects.json');
  }

  get engine(): AnalysisEngine {
    if (!this.session) throw new ProjectError('尚未打开项目。', 503);
    return this.session.engine;
  }

  snapshot(): ProjectSnapshot {
    return { ...this.engine.store.snapshot(), sessionId: this.session!.id };
  }

  list(): ProjectList {
    const current = this.session ? this.recent.find((p) => p.path === this.engine.repoRoot) ?? null : null;
    return { current, projects: this.recent, historyWarning: this.historyWarning };
  }

  async initialize(repoRoot: string): Promise<void> {
    if (this.historyFile) {
      try {
        const data: unknown = JSON.parse(await readFile(this.historyFile, 'utf8'));
        if (!Array.isArray(data)) throw new Error('Invalid project history');
        this.recent = data.filter((p): p is LocalProject => p && typeof p.name === 'string' && typeof p.path === 'string' && isAbsolute(p.path) && typeof p.lastOpened === 'string').slice(0, 20);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.historyWarning = '最近项目记录无法读取，已使用当前项目。';
      }
    }
    await this.open(repoRoot);
  }

  open(input: string): Promise<ProjectSnapshot> {
    const operation = this.transition.catch(() => undefined).then(() => this.switchTo(input));
    this.transition = operation;
    return operation;
  }

  private async switchTo(input: string): Promise<ProjectSnapshot> {
    if (this.closed) throw new ProjectError('服务正在关闭。', 503);
    const path = await validateDirectory(input);
    if (this.session?.engine.repoRoot === path && this.engine.store.getStatus().state !== 'error') return this.snapshot();

    let engine: AnalysisEngine;
    try { engine = new AnalysisEngine(path); }
    catch (error) { throw new ProjectError(`无法初始化项目分析：${error instanceof Error ? error.message : String(error)}`); }
    const id = randomUUID();
    let watcher: WatcherHandle | undefined;
    let activated = false;
    const pending: FsEvent[] = [];
    try {
      if (this.options.watch !== false) {
        watcher = startWatcher(path, (events) => {
          if (!activated) pending.push(...events);
          else if (this.session?.id === id) void engine.enqueueFileEvents(events);
        }, 300, (error) => {
          if (this.session?.id !== id) return;
          const message = `文件监听失败：${error instanceof Error ? error.message : String(error)}`;
          engine.store.setStatus({ state: 'error', message });
          engine.store.pushEvent({ kind: 'info', severity: 'high', message });
        });
        await watcher.ready;
      }
    } catch {
      await watcher?.close();
      await engine.dispose();
      throw new ProjectError('无法监控所选文件夹，请检查访问权限。');
    }

    const previous = this.session;
    previous?.detach();
    await previous?.watcher?.close();
    await previous?.engine.dispose();
    const onDiff = (diff: WorldDiff) => {
      if (this.session?.id === id) this.emit('message', { type: 'diff', sessionId: id, diff } satisfies ServerMessage);
    };
    const onStatus = () => {
      if (this.session?.id === id) this.emit('message', { type: 'snapshot', snapshot: this.snapshot() } satisfies ServerMessage);
    };
    engine.store.on('diff', onDiff);
    engine.store.on('status', onStatus);
    this.session = { id, engine, watcher, detach: () => { engine.store.off('diff', onDiff); engine.store.off('status', onStatus); } };
    this.recent = [{ name: engine.store.snapshot().repoName || basename(path), path, lastOpened: new Date().toISOString() }, ...this.recent.filter((p) => p.path !== path)].slice(0, 20);
    activated = true;
    this.emit('message', { type: 'snapshot', snapshot: this.snapshot() } satisfies ServerMessage);
    void engine.initialScan().catch((error: unknown) => {
      if (this.session?.id !== id) return;
      const message = error instanceof Error ? error.message : String(error);
      engine.store.setStatus({ state: 'error', message });
      engine.store.pushEvent({ kind: 'info', severity: 'high', message: `扫描失败：${message}` });
    });
    if (pending.length) void engine.enqueueFileEvents(pending);
    await this.saveHistory();
    return this.snapshot();
  }

  private async saveHistory(): Promise<void> {
    if (!this.historyFile) return;
    const temporary = `${this.historyFile}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.historyFile), { recursive: true });
      await writeFile(temporary, JSON.stringify(this.recent, null, 2), 'utf8');
      await rename(temporary, this.historyFile);
      this.historyWarning = undefined;
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      this.historyWarning = '最近项目暂未保存到磁盘，本次仍可正常切换。';
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transition.catch(() => undefined);
    this.session?.detach();
    await this.session?.watcher?.close();
    await this.session?.engine.dispose();
    this.removeAllListeners();
  }
}
