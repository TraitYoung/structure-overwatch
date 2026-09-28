// structure-survallian 协议类型：core/server/web 三端共享，零依赖。

// ---------- 图模型 ----------

export type NodeKind = 'file' | 'module' | 'external';

export interface FileMetrics {
  kind: 'file';
  /** 行数 */
  loc: number;
  /** 近似圈复杂度 */
  complexity: number;
  /** 被内部文件导入数 */
  fanIn: number;
  /** 导入内部文件数 */
  fanOut: number;
  /** 0-100 健康度 */
  health: number;
  /** 图情报：结构重要性（PageRank，归一化到 max=1；降级时缺省） */
  pagerank?: number;
  /** 图情报：实际耦合社区编号（label propagation；降级时缺省） */
  community?: number;
}

export interface ModuleMetrics {
  kind: 'module';
  files: number;
  loc: number;
  /** 平均单文件复杂度 */
  complexity: number;
  /** 跨模块依赖入边数 */
  fanIn: number;
  /** 跨模块依赖出边数 */
  fanOut: number;
  /** 不稳定性 fanOut/(fanIn+fanOut)，0-1 */
  instability: number;
  /** 0-100 健康度 */
  health: number;
  /** 是否处于模块级循环依赖中 */
  cyclic: boolean;
  /** 图情报：结构重要性（PageRank，归一化到 max=1） */
  pagerank?: number;
  /** 图情报：模块级耦合社区编号 */
  community?: number;
  /** 图情报：SCC 缩点分层（0=最底层基础层，越大越靠上） */
  layer?: number;
}

export interface GraphNode {
  /** file: 仓库相对 posix 路径；module: `module:<name>`；external: `ext:<pkg>` */
  id: string;
  kind: NodeKind;
  name: string;
  /** file: 文件路径；module: 目录前缀；external: 无 */
  path?: string;
  /** 仅 file 节点：所属模块 id */
  moduleId?: string;
  metrics?: FileMetrics | ModuleMetrics;
}

export type EdgeKind = 'import' | 'type-import' | 'external';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** true 表示 to 是外部 npm 包 */
  external: boolean;
}

// ---------- 违规 ----------

export type Severity = 'high' | 'medium' | 'low';

export type ViolationType =
  | 'cycle'
  | 'layer'
  | 'deep-import'
  | 'god-module'
  | 'orphan'
  /** 图情报：文件实际耦合社区与所属省份不符（重构建议） */
  | 'misplaced'
  /** 图情报：≥3 个模块缩点后仍是一团（熔炉循环群） */
  | 'megacycle'
  /** 图情报：模块依赖跨层直连（跳过中间层） */
  | 'skip-layer';

export interface Violation {
  id: string;
  type: ViolationType;
  severity: Severity;
  title: string;
  detail?: string;
  /** 涉及的节点 id（文件或模块） */
  nodeIds: string[];
  /** 涉及的模块 id（用于地图边境冲突高亮） */
  moduleIds: string[];
}

// ---------- 事件 ----------

export type EventKind =
  | 'file-added'
  | 'file-removed'
  | 'files-changed'
  | 'violation-new'
  | 'violation-resolved'
  | 'health-change'
  | 'analysis'
  | 'info';

export type EventSeverity = Severity | 'info';

export interface WorldEvent {
  id: number;
  ts: number;
  kind: EventKind;
  severity: EventSeverity;
  message: string;
  nodeIds?: string[];
  moduleIds?: string[];
}

// ---------- 快照与增量 ----------

export type AnalysisStatus =
  | { state: 'scanning'; filesDone: number }
  | { state: 'watching' }
  | { state: 'error'; message: string };

export interface WorldSnapshot {
  version: number;
  repoRoot: string;
  repoName: string;
  /** 文件数超限时降级为仅模块级视图 */
  degraded: boolean;
  status: AnalysisStatus;
  nodes: GraphNode[];
  edges: GraphEdge[];
  violations: Violation[];
  events: WorldEvent[];
  boundariesInfo: BoundariesInfo;
}

export interface BoundariesInfo {
  /** 自定义规则文件路径（未提供则 null，使用默认规则） */
  configFile: string | null;
  rulesConfigured: number;
  godModuleFanIn: number;
}

export interface WorldDiff {
  fromVersion: number;
  toVersion: number;
  nodesUpserted: GraphNode[];
  nodesRemoved: string[];
  edgesUpserted: GraphEdge[];
  edgesRemoved: string[];
  /** 违规全量列表（变更后） */
  violations: Violation[];
  /** 本次新增事件 */
  events: WorldEvent[];
  status?: AnalysisStatus;
}

// ---------- WebSocket 协议 ----------

export type ServerMessage =
  | { type: 'hello'; version: number; status: AnalysisStatus }
  | { type: 'diff'; diff: WorldDiff }
  | { type: 'pong' };

export type ClientMessage = { type: 'ping' };

// ---------- 边界规则配置（目标仓库根的 .survallian.json） ----------

/** from 命中的文件若导入了 deny 中的模式即违规（glob，仓库相对 posix 路径） */
export interface BoundaryRule {
  from: string;
  deny: string[];
}

export interface BoundariesConfig {
  rules?: BoundaryRule[];
  /** 模块 fan-in 超过该值提示“上帝模块”，默认 12 */
  godModuleFanIn?: number;
  /** 解析文件数上限，超过则降级，默认 5000 */
  maxFiles?: number;
}

export const DEFAULT_GOD_MODULE_FAN_IN = 12;
export const DEFAULT_MAX_FILES = 5000;
export const CONFIG_FILE_NAME = '.survallian.json';
