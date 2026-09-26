import type { EdgeKind, GraphEdge } from '@surv/shared';
import type { ParsedFile, ParsedImport } from '../parser/parse.js';

export interface FileEdge {
  from: string; // 仓库相对路径
  to: string; // 内部：仓库相对路径；外部：npm 包名
  kind: EdgeKind;
  external: boolean;
}

export function internalEdgeId(from: string, to: string): string {
  return `e:${from}~${to}`;
}

export function externalEdgeId(from: string, pkg: string): string {
  return `e:${from}~ext:${pkg}`;
}

export function toGraphEdge(e: FileEdge): GraphEdge {
  return {
    id: e.external ? externalEdgeId(e.from, e.to) : internalEdgeId(e.from, e.to),
    from: e.from,
    to: e.external ? `ext:${e.to}` : e.to,
    kind: e.kind,
    external: e.external,
  };
}

/** 同一 (from,to) 去重：存在值导入则用 import，否则 type-import；外部按 (from,pkg) 去重 */
function dedupe(imports: readonly ParsedImport[]): FileEdge[] {
  const byTarget = new Map<string, FileEdge>();
  for (const imp of imports) {
    const key = imp.external ? `ext:${imp.to}` : imp.to;
    const prev = byTarget.get(key);
    if (!prev) {
      byTarget.set(key, { from: '', to: imp.to, kind: imp.external ? 'external' : imp.kind, external: imp.external });
    } else if (!prev.external && prev.kind === 'type-import' && imp.kind === 'import') {
      prev.kind = 'import';
    }
  }
  return [...byTarget.values()];
}

function edgeSet(edges: readonly FileEdge[]): Set<string> {
  return new Set(edges.map((e) => toGraphEdge(e).id));
}

/** 仅保留 next 中 prev 没有的边 */
function edgeDiff(next: readonly FileEdge[], prev: readonly FileEdge[]): FileEdge[] {
  const prevIds = edgeSet(prev);
  return next.filter((e) => !prevIds.has(toGraphEdge(e).id));
}

export interface EdgeDelta {
  added: FileEdge[];
  removed: FileEdge[];
}

/** 文件级依赖图：维护 ParsedFile 及其出边，产生增量边差分 */
export class WorldGraph {
  private files = new Map<string, ParsedFile>();
  private edgesByFile = new Map<string, FileEdge[]>();

  allFiles(): ReadonlyMap<string, ParsedFile> {
    return this.files;
  }

  getFile(path: string): ParsedFile | undefined {
    return this.files.get(path);
  }

  /** 全部去重后的边（已回填 from） */
  fileEdges(): FileEdge[] {
    const out: FileEdge[] = [];
    for (const edges of this.edgesByFile.values()) {
      for (const e of edges) out.push(e);
    }
    return out;
  }

  edgesOf(path: string): readonly FileEdge[] {
    return this.edgesByFile.get(path) ?? [];
  }

  upsertFile(pf: ParsedFile): EdgeDelta {
    const prev = this.edgesByFile.get(pf.path) ?? [];
    const next = dedupe(pf.imports).map((e) => ({ ...e, from: pf.path }));
    this.files.set(pf.path, pf);
    this.edgesByFile.set(pf.path, next);
    return { added: edgeDiff(next, prev), removed: edgeDiff(prev, next) };
  }

  /** 返回被移除的边；文件不存在返回 null */
  removeFile(path: string): EdgeDelta | null {
    const prev = this.edgesByFile.get(path);
    if (!this.files.has(path) && !prev) return null;
    this.files.delete(path);
    this.edgesByFile.delete(path);
    return { added: [], removed: prev ?? [] };
  }
}
