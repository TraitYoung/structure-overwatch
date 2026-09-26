import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { GraphEdge, GraphNode } from '@surv/shared';
import { RepoParser, isSourcePath, toRepoRel } from './parser/parse.js';
import { computePartition, type Partition } from './modules/partition.js';
import { WorldGraph, toGraphEdge, type FileEdge } from './graph/worldGraph.js';
import { buildWorld } from './model/buildWorld.js';
import { loadBoundariesConfig, type ResolvedBoundariesConfig } from './boundaries/engine.js';
import { WorldStore, type EventSeed } from './store/worldStore.js';
import type { FsEvent } from './watcher/watcher.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', '.turbo', '.output', '.vite',
]);

function walkSources(repoRoot: string): string[] {
  const out: string[] = [];
  const stack: string[] = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!isSourcePath(full)) continue;
      const rel = toRepoRel(repoRoot, full);
      if (rel) out.push(rel);
    }
  }
  return out.sort();
}

function readPkgName(repoRoot: string): string | null {
  const pkgPath = join(repoRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return typeof pkg.name === 'string' && pkg.name ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * 分析引擎：watcher 的文件事件 → 增量解析 → 图更新 → 指标/违规重算 → store diff。
 * 事件按队列串行处理，保证版本号有序。
 */
export class AnalysisEngine {
  readonly store = new WorldStore();
  private parser: RepoParser;
  private graph = new WorldGraph();
  private partition: Partition | null = null;
  private fileModule = new Map<string, string>();
  private config: ResolvedBoundariesConfig;
  private configError: string | null;
  private queue: Promise<void> = Promise.resolve();
  private prevCycleFiles = new Set<string>();
  private prevModuleIds = new Set<string>();
  private prevExternalIds = new Set<string>();

  constructor(public readonly repoRoot: string) {
    this.parser = new RepoParser(repoRoot);
    const loaded = loadBoundariesConfig(repoRoot);
    this.config = loaded.config;
    this.configError = loaded.error;
    this.store.setMeta({
      repoRoot,
      repoName: readPkgName(repoRoot) ?? basename(repoRoot),
      degraded: false,
      boundariesInfo: {
        configFile: loaded.configFile,
        rulesConfigured: loaded.config.rules.length,
        godModuleFanIn: loaded.config.godModuleFanIn,
      },
    });
  }

  /** 全量首扫：遍历 → 解析 → 建图 → 一次性下发完整世界 */
  async initialScan(): Promise<void> {
    const files = walkSources(this.repoRoot);
    const degraded = files.length > this.config.maxFiles;
    if (degraded) {
      this.store.setMeta({
        repoRoot: this.repoRoot,
        repoName: this.store.snapshot().repoName,
        degraded: true,
        boundariesInfo: this.store.snapshot().boundariesInfo,
      });
    }

    this.store.setStatus({ state: 'scanning', filesDone: 0 });
    let done = 0;
    let lastEmit = Date.now();
    for (const rel of files) {
      const parsed = this.parser.addFile(join(this.repoRoot, rel));
      if (parsed) {
        this.graph.upsertFile(parsed);
        done += 1;
      }
      const now = Date.now();
      if (now - lastEmit > 400) {
        this.store.setStatus({ state: 'scanning', filesDone: done });
        lastEmit = now;
      }
    }

    this.refreshPartition();
    const world = this.buildWorld();
    this.prevCycleFiles = new Set(world.fileCycles.flat());
    this.prevModuleIds = new Set(world.nodes.filter((n) => n.kind === 'module').map((n) => n.id));
    this.prevExternalIds = new Set(world.nodes.filter((n) => n.kind === 'external').map((n) => n.id));

    const seeds: EventSeed[] = [];
    if (this.configError) {
      seeds.push({ kind: 'info', severity: 'medium', message: `.survallian.json 解析失败：${this.configError}（已回退默认规则）` });
    }
    if (degraded) {
      seeds.push({ kind: 'info', severity: 'medium', message: `文件数 ${files.length} 超过上限 ${this.config.maxFiles}，解析可能变慢` });
    }
    const moduleCount = world.nodes.filter((n) => n.kind === 'module').length;
    seeds.push({
      kind: 'analysis',
      message: `扫描完成：${world.fileCount} 个文件、${moduleCount} 个省份、${world.edges.length} 条依赖、${world.violations.length} 项违规`,
    });

    this.store.apply({
      nodesUpserted: world.nodes,
      edgesUpserted: world.edges,
      violations: world.violations,
      events: seeds,
      status: { state: 'watching' },
    });
  }

  /** 文件事件入队（串行处理，返回排队完成后的 Promise） */
  enqueueFileEvents(events: FsEvent[]): Promise<void> {
    this.queue = this.queue
      .then(() => this.handleFileEvents(events))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.store.pushEvent({ kind: 'info', severity: 'medium', message: `处理文件变更失败：${message}` });
      });
    return this.queue;
  }

  private handleFileEvents(events: readonly FsEvent[]): void {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const touched = new Set<string>();
    const edgesUpserted = new Map<string, GraphEdge>();
    const edgesRemoved = new Map<string, FileEdge>();

    for (const ev of events) {
      if (!isSourcePath(ev.absPath)) continue;
      const rel = toRepoRel(this.repoRoot, ev.absPath);
      if (!rel) continue;

      if (ev.type === 'unlink') {
        this.parser.removeFile(ev.absPath);
        const delta = this.graph.removeFile(rel);
        if (delta) {
          for (const e of delta.removed) {
            edgesUpserted.delete(toGraphEdge(e).id);
            edgesRemoved.set(toGraphEdge(e).id, e);
            touched.add(e.from);
            if (!e.external) touched.add(e.to);
          }
          removed.push(rel);
          touched.delete(rel);
        }
        continue;
      }

      const parsed = ev.type === 'add' ? this.parser.addFile(ev.absPath) : this.parser.updateFile(ev.absPath);
      if (!parsed) continue;
      const delta = this.graph.upsertFile(parsed);
      for (const e of delta.added) {
        edgesRemoved.delete(toGraphEdge(e).id);
        edgesUpserted.set(toGraphEdge(e).id, toGraphEdge(e));
        touched.add(e.from);
        if (!e.external) touched.add(e.to);
      }
      for (const e of delta.removed) {
        edgesUpserted.delete(toGraphEdge(e).id);
        edgesRemoved.set(toGraphEdge(e).id, e);
        touched.add(e.from);
        if (!e.external) touched.add(e.to);
      }
      (ev.type === 'add' ? added : changed).push(rel);
      touched.add(rel);
    }

    if (added.length === 0 && removed.length === 0 && changed.length === 0) return;

    this.refreshPartition();
    const world = this.buildWorld();

    // 循环成员变化的文件，指标（健康度）会变，需要重新下发
    const curCycleFiles = new Set(world.fileCycles.flat());
    for (const f of curCycleFiles) if (!this.prevCycleFiles.has(f)) touched.add(f);
    for (const f of this.prevCycleFiles) if (!curCycleFiles.has(f)) touched.add(f);
    this.prevCycleFiles = curCycleFiles;

    const moduleNodes = world.nodes.filter((n): n is GraphNode & { kind: 'module' } => n.kind === 'module');
    const externalNodes = world.nodes.filter((n): n is GraphNode & { kind: 'external' } => n.kind === 'external');
    const curModuleIds = new Set(moduleNodes.map((n) => n.id));
    const curExternalIds = new Set(externalNodes.map((n) => n.id));

    const nodesRemoved: string[] = [...removed];
    for (const id of this.prevModuleIds) if (!curModuleIds.has(id)) nodesRemoved.push(id);
    for (const id of this.prevExternalIds) if (!curExternalIds.has(id)) nodesRemoved.push(id);
    this.prevModuleIds = curModuleIds;
    this.prevExternalIds = curExternalIds;

    const nodesUpserted = [
      ...moduleNodes,
      ...externalNodes,
      ...world.nodes.filter((n) => n.kind === 'file' && touched.has(n.id)),
    ];

    const seeds: EventSeed[] = [];
    for (const rel of added) {
      const pf = this.graph.getFile(rel);
      seeds.push({
        kind: 'file-added',
        message: `新增文件 ${rel}（${pf?.loc ?? '?'} 行）`,
        nodeIds: [rel],
        moduleIds: this.fileModule.get(rel) ? [this.fileModule.get(rel)!] : undefined,
      });
    }
    for (const rel of removed) {
      seeds.push({ kind: 'file-removed', message: `文件已移除 ${rel}` });
    }
    if (changed.length > 0) {
      const head = changed.slice(0, 3).join('、');
      seeds.push({
        kind: 'files-changed',
        message: changed.length <= 3 ? `文件变更：${head}` : `检测到 ${changed.length} 个文件变更：${head} 等`,
        nodeIds: changed.slice(0, 20),
      });
    }
    // 模块健康度显著变化（±5）时播报
    for (const m of moduleNodes) {
      const prev = this.store.moduleHealthById(m.id);
      const cur = m.metrics?.kind === 'module' ? m.metrics.health : undefined;
      if (prev === undefined || cur === undefined || Math.abs(cur - prev) < 5) continue;
      seeds.push({
        kind: 'health-change',
        severity: cur < prev ? (prev - cur >= 15 ? 'high' : 'medium') : 'info',
        message: `省份 ${m.name} 健康度 ${prev} → ${cur}`,
        moduleIds: [m.id],
      });
    }

    this.store.apply({
      nodesUpserted,
      nodesRemoved,
      edgesUpserted: [...edgesUpserted.values()],
      edgesRemoved: [...edgesRemoved.keys()],
      violations: world.violations,
      events: seeds,
    });
  }

  private refreshPartition(): void {
    const allPaths = [...this.graph.allFiles().keys()].sort();
    this.partition = computePartition(this.repoRoot, allPaths);
    this.fileModule = new Map(allPaths.map((p) => [p, this.partition!.moduleIdOf(p)]));
  }

  private buildWorld() {
    if (!this.partition) this.refreshPartition();
    return buildWorld({
      graph: this.graph,
      fileModule: this.fileModule,
      modules: this.partition!.modules,
      config: this.config,
    });
  }
}
