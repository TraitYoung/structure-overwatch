import { EventEmitter } from 'node:events';
import type {
  AnalysisStatus,
  BoundariesInfo,
  EventKind,
  EventSeverity,
  GraphEdge,
  GraphNode,
  Violation,
  WorldDiff,
  WorldEvent,
  WorldSnapshot,
} from '@surv/shared';

export interface EventSeed {
  kind: EventKind;
  severity?: EventSeverity;
  message: string;
  nodeIds?: string[];
  moduleIds?: string[];
}

export interface WorldUpdate {
  nodesUpserted?: GraphNode[];
  nodesRemoved?: string[];
  edgesUpserted?: GraphEdge[];
  edgesRemoved?: string[];
  /** 违规全量列表（本次更新后） */
  violations?: Violation[];
  events?: EventSeed[];
  status?: AnalysisStatus;
}

const MAX_EVENTS = 300;

/** 世界状态：版本号递增、违规对比产生新/解除事件、事件环形日志、快照导出 */
export class WorldStore extends EventEmitter {
  private version = 0;
  private status: AnalysisStatus = { state: 'scanning', filesDone: 0 };
  private repoRoot = '';
  private repoName = '';
  private degraded = false;
  private boundariesInfo: BoundariesInfo = { configFile: null, rulesConfigured: 0, godModuleFanIn: 12 };
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private violations: Violation[] = [];
  private events: WorldEvent[] = [];
  private nextEventId = 1;

  setMeta(meta: {
    repoRoot: string;
    repoName: string;
    degraded: boolean;
    boundariesInfo: BoundariesInfo;
  }): void {
    this.repoRoot = meta.repoRoot;
    this.repoName = meta.repoName;
    this.degraded = meta.degraded;
    this.boundariesInfo = meta.boundariesInfo;
  }

  setStatus(status: AnalysisStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  getStatus(): AnalysisStatus {
    return this.status;
  }

  /** 追加事件（不产生 diff），供扫描进度等场景使用 */
  pushEvent(seed: EventSeed): WorldEvent {
    const ev: WorldEvent = {
      id: this.nextEventId++,
      ts: Date.now(),
      kind: seed.kind,
      severity: seed.severity ?? 'info',
      message: seed.message,
      nodeIds: seed.nodeIds,
      moduleIds: seed.moduleIds,
    };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return ev;
  }

  /**
   * 应用一次世界更新：版本 +1，与上次违规列表对比自动生成“新违规/违规解除”事件。
   * 返回可直接下发的 diff。
   */
  apply(update: WorldUpdate): WorldDiff {
    const fromVersion = this.version;
    this.version += 1;

    const nodesUpserted = update.nodesUpserted ?? [];
    for (const n of nodesUpserted) this.nodes.set(n.id, n);
    const nodesRemoved = update.nodesRemoved ?? [];
    for (const id of nodesRemoved) this.nodes.delete(id);

    const edgesUpserted = update.edgesUpserted ?? [];
    for (const e of edgesUpserted) this.edges.set(e.id, e);
    const edgesRemoved = update.edgesRemoved ?? [];
    for (const id of edgesRemoved) this.edges.delete(id);

    const newEvents: WorldEvent[] = [];
    if (update.violations) {
      const prev = new Map(this.violations.map((v) => [v.id, v]));
      const next = new Map(update.violations.map((v) => [v.id, v]));
      for (const v of update.violations) {
        if (!prev.has(v.id)) {
          newEvents.push(
            this.pushEvent({
              kind: 'violation-new',
              severity: v.severity,
              message: `新违规：${v.title}`,
              nodeIds: v.nodeIds,
              moduleIds: v.moduleIds,
            }),
          );
        }
      }
      for (const v of this.violations) {
        if (!next.has(v.id)) {
          newEvents.push(
            this.pushEvent({ kind: 'violation-resolved', severity: 'info', message: `违规解除：${v.title}` }),
          );
        }
      }
      this.violations = update.violations;
    }
    for (const seed of update.events ?? []) newEvents.push(this.pushEvent(seed));

    const diff: WorldDiff = {
      fromVersion,
      toVersion: this.version,
      nodesUpserted,
      nodesRemoved,
      edgesUpserted,
      edgesRemoved,
      violations: this.violations,
      events: newEvents,
      status: update.status,
    };
    if (update.status) this.status = update.status;
    this.emit('diff', diff);
    return diff;
  }

  snapshot(): WorldSnapshot {
    return {
      version: this.version,
      repoRoot: this.repoRoot,
      repoName: this.repoName,
      degraded: this.degraded,
      status: this.status,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      violations: this.violations,
      events: [...this.events],
      boundariesInfo: this.boundariesInfo,
    };
  }

  /** 模块健康度（供健康变化事件对比） */
  moduleHealthById(id: string): number | undefined {
    const n = this.nodes.get(id);
    return n?.metrics && n.metrics.kind === 'module' ? n.metrics.health : undefined;
  }
}
