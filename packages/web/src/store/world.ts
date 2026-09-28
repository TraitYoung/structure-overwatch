import { create } from 'zustand';
import type {
  AnalysisStatus,
  BoundariesInfo,
  GraphEdge,
  GraphNode,
  Violation,
  WorldEvent,
  WorldSnapshot,
} from '@surv/shared';

export type DrawerId = 'deps' | 'boundaries' | null;

export interface WorldState {
  loaded: boolean;
  connected: boolean;
  version: number;
  repoName: string;
  repoRoot: string;
  degraded: boolean;
  status: AnalysisStatus;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  violations: Violation[];
  events: WorldEvent[];
  boundariesInfo: BoundariesInfo;
  /** rev 每次数据变化 +1，供需要响应数据变化的组件使用 */
  rev: number;
  selectedModuleId: string | null;
  drawer: DrawerId;
  isoOpen: boolean;

  applySnapshot: (snap: WorldSnapshot) => void;
  applyDiff: (diff: import('@surv/shared').WorldDiff, resync: () => void) => void;
  setConnected: (v: boolean) => void;
  selectModule: (id: string | null) => void;
  setDrawer: (d: DrawerId) => void;
  setIsoOpen: (v: boolean) => void;
}

const MAX_EVENTS = 200;

export const useWorld = create<WorldState>()((set, get) => ({
  loaded: false,
  connected: false,
  version: 0,
  repoName: '',
  repoRoot: '',
  degraded: false,
  status: { state: 'scanning', filesDone: 0 },
  nodes: new Map(),
  edges: new Map(),
  violations: [],
  events: [],
  boundariesInfo: { configFile: null, rulesConfigured: 0, godModuleFanIn: 12 },
  rev: 0,
  selectedModuleId: null,
  drawer: null,
  isoOpen: false,

  applySnapshot: (snap) => {
    const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
    const edges = new Map(snap.edges.map((e) => [e.id, e]));
    set({
      loaded: true,
      version: snap.version,
      repoName: snap.repoName,
      repoRoot: snap.repoRoot,
      degraded: snap.degraded,
      status: snap.status,
      nodes,
      edges,
      violations: snap.violations,
      events: snap.events.slice(-MAX_EVENTS),
      boundariesInfo: snap.boundariesInfo,
      rev: get().rev + 1,
    });
  },

  applyDiff: (diff, resync) => {
    if (diff.fromVersion !== get().version) {
      resync();
      return;
    }
    const nodes = get().nodes;
    const edges = get().edges;
    for (const n of diff.nodesUpserted) nodes.set(n.id, n);
    for (const id of diff.nodesRemoved) nodes.delete(id);
    for (const e of diff.edgesUpserted) edges.set(e.id, e);
    for (const id of diff.edgesRemoved) edges.delete(id);

    const events = [...get().events, ...diff.events].slice(-MAX_EVENTS);
    mapSignals.recordChanges(diff.nodesUpserted.filter((n) => n.kind === 'file').map((n) => n.id));
    if (diff.events.some((e) => e.kind === 'violation-new')) mapSignals.pulseAlert();

    set({
      version: diff.toVersion,
      nodes,
      edges,
      violations: diff.violations,
      events,
      status: diff.status ?? get().status,
      rev: get().rev + 1,
    });
  },

  setConnected: (v) => set({ connected: v }),

  selectModule: (id) => set({ selectedModuleId: id, isoOpen: id === null ? false : get().isoOpen }),

  setDrawer: (d) => set({ drawer: d }),

  setIsoOpen: (v) => set({ isoOpen: v }),
}));

/** 波及分析结果（地图渲染专用，右键文件触发） */
export interface ImpactInfo {
  fileId: string;
  /** 会被波及的文件（反向传递：谁传递依赖我） */
  downstream: ReadonlySet<string>;
  /** 依赖供给链（正向传递：我传递依赖谁） */
  upstream: ReadonlySet<string>;
  /** 下游受影响文件涉及的模块 */
  modules: ReadonlySet<string>;
}

/** 地图渲染专用的易变信号：变更脉冲与边境冲突高亮（不触发 React 渲染） */
export const mapSignals = {
  /** fileId -> 最近变更时间戳（ms） */
  changes: new Map<string, number>(),
  /** 边境冲突高亮：模块 id 集合 + 失效时间 */
  highlight: { ids: new Set<string>(), until: 0 },
  alertPulseUntil: 0,
  /** 波及分析（右键文件触发，Esc/点空白清除） */
  impact: null as ImpactInfo | null,

  recordChanges(fileIds: string[], now = Date.now()) {
    for (const id of fileIds) this.changes.set(id, now);
    // 清理旧记录，避免无限增长
    if (this.changes.size > 2000) {
      const cutoff = now - 5000;
      for (const [k, ts] of this.changes) if (ts < cutoff) this.changes.delete(k);
    }
  },

  flashModules(moduleIds: string[], durationMs = 3200) {
    this.highlight.ids = new Set(moduleIds);
    this.highlight.until = Date.now() + durationMs;
  },

  pulseAlert() {
    this.alertPulseUntil = Date.now() + 900;
  },
};
