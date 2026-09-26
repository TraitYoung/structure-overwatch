import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { EdgeKind, GraphEdge, GraphNode } from '@surv/shared';
import { useWorld } from '../store/world';
import { provinceColor } from '../map/colors';

interface ForceNode extends SimulationNodeDatum {
  id: string;
  name: string;
  kind: 'module' | 'external';
  radius: number;
  weight: number; // files 或 fanIn
}

interface ForceLink extends SimulationLinkDatum<ForceNode> {
  weight: number;
}

const KIND_LABEL: Record<EdgeKind, string> = {
  import: '值导入',
  'type-import': '类型导入',
  external: '外部包',
};

export function DepsPanel(): JSX.Element {
  const rev = useWorld((st) => st.rev);
  const nodes = useWorld((st) => st.nodes);
  const edges = useWorld((st) => st.edges);
  const selectedModuleId = useWorld((st) => st.selectedModuleId);
  const [kinds, setKinds] = useState<Set<EdgeKind>>(new Set(['import', 'type-import', 'external']));
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<ForceNode[]>([]);
  const simRef = useRef<Simulation<ForceNode, ForceLink> | null>(null);

  const toggleKind = (k: EdgeKind) => {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // 构建模块级力导向图
  const { moduleNodes, moduleLinks } = useMemo(() => {
    const mods = [...nodes.values()].filter((n): n is GraphNode & { kind: 'module' } => n.kind === 'module');
    const externals = new Map<string, number>(); // pkg -> 引用模块数
    const linkAgg = new Map<string, number>(); // fromId|toId -> weight
    const modIds = new Set(mods.map((m) => m.id));

    for (const e of edges.values()) {
      if (!kinds.has(e.kind)) continue;
      const from = nodes.get(e.from);
      if (!from || from.kind !== 'file' || !from.moduleId || !modIds.has(from.moduleId)) continue;
      if (e.external) {
        const pkg = e.to.replace(/^ext:/, '');
        externals.set(pkg, (externals.get(pkg) ?? 0) + 1);
        linkAgg.set(`${from.moduleId}|${e.to}`, (linkAgg.get(`${from.moduleId}|${e.to}`) ?? 0) + 1);
      } else {
        const to = nodes.get(e.to);
        if (!to || to.kind !== 'file' || !to.moduleId || !modIds.has(to.moduleId)) continue;
        if (to.moduleId === from.moduleId) continue;
        linkAgg.set(`${from.moduleId}|${to.moduleId}`, (linkAgg.get(`${from.moduleId}|${to.moduleId}`) ?? 0) + 1);
      }
    }

    const forceMods: ForceNode[] = mods.map((m) => ({
      id: m.id,
      name: m.name,
      kind: 'module' as const,
      radius: 8 + Math.sqrt(m.metrics?.kind === 'module' ? m.metrics.files : 1) * 2.6,
      weight: m.metrics?.kind === 'module' ? m.metrics.files : 1,
    }));
    const forceExternals: ForceNode[] = [...externals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 24) // 外部包太多时只显示最常用的
      .map(([pkg, fanIn]) => ({
        id: `ext:${pkg}`,
        name: pkg,
        kind: 'external' as const,
        radius: 5 + Math.sqrt(fanIn) * 2,
        weight: fanIn,
      }));
    const byId = new Map([...forceMods, ...forceExternals].map((n) => [n.id, n]));

    const links: ForceLink[] = [];
    for (const [key, weight] of linkAgg) {
      const [from, to] = key.split('|');
      const source = byId.get(from);
      const target = byId.get(to);
      if (source && target) links.push({ source, target, weight });
    }
    return { moduleNodes: [...forceMods, ...forceExternals], moduleLinks: links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, kinds]);

  // 力导向布局（同步跑 300 tick）
  useEffect(() => {
    const W = 340;
    const H = 360;
    const simNodes: ForceNode[] = moduleNodes.map((n, i) => ({
      ...n,
      // 确定性初始位置：圆周均匀分布
      x: W / 2 + Math.cos((i / Math.max(1, moduleNodes.length)) * Math.PI * 2) * 120,
      y: H / 2 + Math.sin((i / Math.max(1, moduleNodes.length)) * Math.PI * 2) * 120,
    }));
    simNodesRef.current = simNodes;
    const sim = forceSimulation<ForceNode, ForceLink>(simNodes)
      .force(
        'link',
        forceLink<ForceNode, ForceLink>(moduleLinks)
          .distance((l) => 90 - Math.min(40, l.weight * 6))
          .strength(0.4),
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide<ForceNode>((n) => n.radius + 6))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [moduleNodes, moduleLinks]);

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 340;
    const H = 360;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const byId = new Map(simNodesRef.current.map((n) => [n.id, n]));

    // 边
    for (const l of moduleLinks) {
      const s = byId.get(l.source as unknown as string) ?? (l.source as unknown as ForceNode);
      const t = byId.get(l.target as unknown as string) ?? (l.target as unknown as ForceNode);
      if (!s?.x || !s?.y || !t?.x || !t?.y) continue;
      const isExternal = t.kind === 'external';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isExternal ? 'rgba(140, 160, 200, 0.30)' : 'rgba(226, 183, 105, 0.38)';
      ctx.lineWidth = Math.min(4, 0.8 + l.weight * 0.4);
      ctx.stroke();
    }

    // 节点
    for (const n of simNodesRef.current) {
      if (!n.x || !n.y) continue;
      const isSel = selectedNode?.id === n.id;
      const isMapSel = selectedModuleId === n.id;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.kind === 'module' ? provinceColor(n.name).bright : '#8ba3c7';
      ctx.fill();
      if (n.kind === 'external') {
        ctx.strokeStyle = 'rgba(20,24,34,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (isSel || isMapSel) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = isMapSel ? '#ffffff' : '#9be89b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // 标签
      ctx.font = `${n.kind === 'module' ? 600 : 400} 10px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = n.kind === 'module' ? '#f2ead8' : '#8ba3c7';
      const label = n.name.length > 12 ? `${n.name.slice(0, 11)}…` : n.name;
      ctx.fillText(label, n.x, n.y + n.radius + 2);
    }
  }, [moduleLinks, selectedNode, selectedModuleId]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit: ForceNode | null = null;
    let best = Infinity;
    for (const n of simNodesRef.current) {
      if (!n.x || !n.y) continue;
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d <= n.radius + 4 && d < best) {
        best = d;
        hit = n;
      }
    }
    setSelectedNode(hit);
    // 与地图联动：选中模块节点时同步地图选中
    if (hit?.kind === 'module') useWorld.getState().selectModule(hit.id);
  };

  // 节点详情：fan-in / fan-out 列表
  const detail = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.kind === 'external') {
      const importers = new Map<string, number>();
      for (const e of edges.values()) {
        if (!e.external || e.to !== selectedNode.id) continue;
        const from = nodes.get(e.from);
        if (from?.moduleId) importers.set(from.moduleId, (importers.get(from.moduleId) ?? 0) + 1);
      }
      return {
        incoming: [...importers.entries()].sort((a, b) => b[1] - a[1]),
        outgoing: [],
      };
    }
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const l of moduleLinks) {
      const s = l.source as unknown as ForceNode;
      const t = l.target as unknown as ForceNode;
      if (t.id === selectedNode.id) incoming.set(s.id, (incoming.get(s.id) ?? 0) + l.weight);
      if (s.id === selectedNode.id) outgoing.set(t.id, (outgoing.get(t.id) ?? 0) + l.weight);
    }
    const nameOf = (id: string) => nodes.get(id)?.name ?? id.replace(/^ext:/, '');
    return {
      incoming: [...incoming.entries()].sort((a, b) => b[1] - a[1]).map(([id, w]) => [nameOf(id), w] as [string, number]),
      outgoing: [...outgoing.entries()].sort((a, b) => b[1] - a[1]).map(([id, w]) => [nameOf(id), w] as [string, number]),
    };
  }, [selectedNode, moduleLinks, nodes, edges]);

  return (
    <div className="panel deps-panel">
      <div className="panel-header">
        <span className="panel-title">依赖星图</span>
        <span className="panel-count">{moduleNodes.length} 节点</span>
      </div>
      <div className="deps-filters">
        {(Object.keys(KIND_LABEL) as EdgeKind[]).map((k) => (
          <label key={k} className={`filter-chip ${kinds.has(k) ? 'on' : ''}`}>
            <input type="checkbox" checked={kinds.has(k)} onChange={() => toggleKind(k)} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </div>
      <canvas ref={canvasRef} className="deps-canvas" onClick={onCanvasClick} />
      {selectedNode ? (
        <div className="deps-detail">
          <div className="deps-detail-name">
            {selectedNode.kind === 'module' ? '省份' : '外部'} · {selectedNode.name}
          </div>
          {detail && detail.incoming.length > 0 && (
            <div className="deps-detail-row">
              <span className="deps-detail-label">被依赖</span>
              {detail.incoming.map(([name, w]) => (
                <span key={name} className="dep-pill">{name} ×{w}</span>
              ))}
            </div>
          )}
          {detail && detail.outgoing.length > 0 && (
            <div className="deps-detail-row">
              <span className="deps-detail-label">依赖</span>
              {detail.outgoing.map(([name, w]) => (
                <span key={name} className="dep-pill">{name} ×{w}</span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel-empty">点击节点查看依赖详情；选中省份节点会同步地图。</div>
      )}
    </div>
  );
}
