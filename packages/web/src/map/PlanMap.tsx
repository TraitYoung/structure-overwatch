import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '@surv/shared';
import { mapSignalEvents, mapSignals, useWorld } from '../store/world';
import { aggregateModuleRoads } from './render';

export function PlanMap(): JSX.Element {
  const nodes = useWorld((s) => s.nodes);
  const edges = useWorld((s) => s.edges);
  const selected = useWorld((s) => s.selectedModuleId);
  const loaded = useWorld((s) => s.loaded);
  const rev = useWorld((s) => s.rev);
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef({ x: 0, y: 0, moved: 0, active: false });
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [changed, setChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let highlightTimer = 0, changeTimer = 0;
    const highlight = () => {
      setHighlighted(new Set(mapSignals.highlight.ids));
      window.clearTimeout(highlightTimer);
      highlightTimer = window.setTimeout(() => setHighlighted(new Set()), Math.max(0, mapSignals.highlight.until - Date.now()));
    };
    const change = () => {
      setChanged(new Set([...mapSignals.changes].filter(([, time]) => Date.now() - time < 2500).map(([id]) => id)));
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => setChanged(new Set()), 2500);
    };
    mapSignalEvents.addEventListener('highlight', highlight);
    mapSignalEvents.addEventListener('change', change);
    return () => {
      mapSignalEvents.removeEventListener('highlight', highlight);
      mapSignalEvents.removeEventListener('change', change);
      window.clearTimeout(highlightTimer); window.clearTimeout(changeTimer);
    };
  }, []);

  const plan = useMemo(() => {
    const modules = [...nodes.values()].filter((n) => n.kind === 'module').sort((a, b) => a.id.localeCompare(b.id));
    const aspect = size.width / Math.max(1, size.height);
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(modules.length * aspect * .58))));
    let y = 68;
    const groups: Array<{ node: GraphNode; files: GraphNode[]; x: number; y: number; width: number; height: number; index: number }> = [];
    for (let row = 0; row < Math.ceil(modules.length / columns); row++) {
      let rowHeight = 0;
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        const node = modules[index];
        if (!node) continue;
        const files = [...nodes.values()].filter((n) => n.kind === 'file' && n.moduleId === node.id).sort((a, b) => a.id.localeCompare(b.id));
        const height = 106 + Math.max(1, Math.ceil(files.length / 6)) * 29;
        groups.push({ node, files, x: 64 + col * 302, y, width: 234, height, index });
        rowHeight = Math.max(rowHeight, height);
      }
      y += rowHeight + 88;
    }
    return { groups, columns, width: columns * 302 + 30, height: Math.max(300, y - 20), roads: aggregateModuleRoads(nodes, edges) };
  }, [nodes, edges, rev, size.width, size.height]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.max(.35, Math.min(4, value * Math.exp(-event.deltaY * .0015))));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const fit = Math.min((size.width - 60) / plan.width, (size.height - 100) / plan.height, 1.35);
  const scale = Math.max(.1, fit) * zoom;
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const groupById = new Map(plan.groups.map((g) => [g.node.id, g]));
  const hasData = plan.groups.length > 0;

  return <div className="plan-map" ref={container}>
    <div className="plan-topline"><span><i /> MODULE PLAN <b>/</b> 模块与依赖关系</span><span>正交投影 · ORTHOGRAPHIC</span></div>
    <svg ref={svg} className="plan-svg" width="100%" height="100%" aria-label="架构总平面图，使用模块索引选择模块，或拖拽和滚轮缩放" onPointerDown={(e) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, moved: 0, active: true };
      // Keep group click targets intact; pointer capture is only needed for background panning.
      if (e.target === e.currentTarget) e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={(e) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
      drag.current.moved += Math.abs(dx) + Math.abs(dy);
      drag.current.x = e.clientX; drag.current.y = e.clientY;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }} onPointerUp={() => { drag.current.active = false; }} onPointerCancel={() => { drag.current.active = false; }} onPointerLeave={() => { drag.current.active = false; setHover(null); }} onClick={(e) => {
      if (drag.current.moved < 5 && e.target === e.currentTarget) useWorld.getState().selectModule(null);
    }}>
      <defs>
        <marker id="plan-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 7 4 1 7" fill="none" stroke="context-stroke" strokeWidth="1" /></marker>
      </defs>
      <g transform={`translate(${size.width / 2 + pan.x}, ${size.height / 2 + pan.y}) scale(${scale}) translate(${-plan.width / 2}, ${-plan.height / 2})`}>
        {hasData && <g className="plan-axes" aria-hidden="true"><path d={`M24 30H${plan.width - 18}M24 30V${plan.height - 24}`} /><text x="12" y="20">Y</text><text x={plan.width - 12} y="34">X</text>{plan.groups.filter((g) => g.index < plan.columns).map((g) => <g key={g.node.id}><path d={`M${g.x + g.width / 2} 18V${plan.height - 18}`} /><circle cx={g.x + g.width / 2} cy="30" r="11" /><text x={g.x + g.width / 2} y="34" textAnchor="middle">{String.fromCharCode(65 + g.index)}</text></g>)}</g>}
        {plan.roads.map((road, index) => {
          const a = groupById.get(road.from), b = groupById.get(road.to);
          if (!a || !b) return null;
          const sameRow = a.y === b.y;
          const offset = index % 4 * 4;
          const x1 = a.x + a.width, y1 = a.y + a.height / 2 + offset;
          const sameColumn = a.x === b.x;
          const x2 = sameColumn ? b.x + b.width + 5 : b.x - 5;
          const y2 = b.y + b.height / 2 + offset;
          const lane = b.y - 21 - offset;
          // Travel in the inter-module margins so a line never appears to connect through a third module.
          const d = sameRow && b.x - a.x === 302
            ? `M${x1} ${y1}H${x2}`
            : `M${x1} ${y1}H${x1 + 14 + offset}V${lane}H${sameColumn ? x2 + 10 + offset : x2 - 10 - offset}V${y2}H${x2}`;
          return <path key={`${road.from}:${road.to}`} d={d} className={`plan-relation ${selected === road.from || selected === road.to ? 'active' : ''}`} markerEnd="url(#plan-arrow)"><title>{a.node.name} → {b.node.name} · {road.weight} 条依赖</title></path>;
        })}
        {plan.groups.map(({ node, x, y, width, height, files, index }) => {
          const metrics = node.metrics?.kind === 'module' ? node.metrics : null;
          const warning = (metrics?.health ?? 100) < 70 || metrics?.cyclic;
          const isSelected = selected === node.id;
          return <g key={node.id} className={`plan-group ${isSelected ? 'selected' : ''} ${warning ? 'warning' : ''} ${highlighted.has(node.id) ? 'highlighted' : ''}`} transform={`translate(${x}, ${y})`} role="button" tabIndex={0} aria-label={`模块 ${node.name}，${files.length} 个文件${warning ? '，存在架构问题' : ''}`} aria-pressed={isSelected} onClick={() => { if (drag.current.moved < 5) useWorld.getState().selectModule(node.id); }} onDoubleClick={() => { useWorld.getState().selectModule(node.id); useWorld.getState().setIsoOpen(true); }} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useWorld.getState().selectModule(node.id); }
          }}>
            <rect className="plan-group-outline" width={width} height={height} />
            <rect className="plan-group-inner" x="5" y="5" width={width - 10} height={height - 10} />
            <line className="plan-group-rule" x1="5" y1="48" x2={width - 5} y2="48" />
            <circle className="plan-node-number" cx="0" cy="-16" r={Math.max(10, 7 / scale)} /><text className="plan-number-text" style={{ fontSize: Math.max(8, 7 / scale) }} x="0" y={-16 + Math.max(3, 2.5 / scale)} textAnchor="middle">{String(index + 1).padStart(2, '0')}</text>
            <text className="plan-module-name" style={{ fontSize: Math.max(17, 11 / scale) }} x="16" y="29">{node.name.length > (scale < .6 ? 12 : 23) ? node.name.slice(0, scale < .6 ? 11 : 22) + '…' : node.name}</text>
            <title>{node.path || node.name}</title>
            {files.map((file, i) => {
              const m = file.metrics?.kind === 'file' ? file.metrics : null;
              return <g key={file.id} transform={`translate(${16 + (i % 6) * 34}, ${64 + Math.floor(i / 6) * 29})`} onPointerEnter={() => setHover(file)} onPointerLeave={() => setHover(null)}>
                <rect className={`plan-file ${(m?.health ?? 100) < 70 ? 'is-warning' : ''} ${changed.has(file.id) ? 'is-changed' : ''}`} width="29" height="23" /><path className="plan-file-door" d="M21 23v-6a6 6 0 0 1 6 6" />{scale >= .7 && <text className="plan-file-number" x="5" y="13">{String(i + 1).padStart(2, '0')}</text>}<title>{file.path || file.name} · {m?.loc ?? 0} 行 · 健康度 {m?.health ?? '—'}</title>
              </g>;
            })}
            <text className="plan-module-meta" style={{ fontSize: Math.max(8, 8 / scale) }} x="16" y={height - 13}>{scale < .65 ? `${files.length} FILES` : `${String(files.length).padStart(2, '0')} FILES / ${metrics?.loc.toLocaleString() ?? '—'} LOC`}</text>
            <text className={`plan-health ${warning ? 'is-warning' : ''}`} style={{ fontSize: Math.max(9, 8 / scale) }} x={width - 16} y={height - 13} textAnchor="end">{warning ? '△' : '○'} {metrics?.health ?? '—'}</text>
          </g>;
        })}
      </g>
    </svg>
    {!hasData && <div className="plan-empty"><svg viewBox="0 0 160 160" width="130" fill="none" aria-hidden="true"><circle cx="80" cy="80" r="62"/><circle cx="80" cy="80" r="43"/><path d="M0 80h160M80 0v160M36 124V50h88v74ZM48 124V62h64v62M65 124V85a15 15 0 0 1 30 0v39M25 133h110"/></svg><span className="eyebrow">A—01 / NO PROJECT DATA</span><h2>{loaded ? '项目中暂无可展示的模块' : '一张等待展开的架构图纸'}</h2><p>{loaded ? '当前分析支持 TypeScript 与 JavaScript 源文件。' : '连接本地分析服务后，即可阅读模块、文件与它们的关系。'}</p></div>}
    {hover && <div className="plan-tooltip" role="status"><strong>{hover.path || hover.name}</strong>{hover.metrics?.kind === 'file' && <span>{hover.metrics.loc} 行 · 复杂度 {hover.metrics.complexity} · 健康度 {hover.metrics.health}</span>}</div>}
    <div className="plan-north" aria-hidden="true"><span>N</span><svg width="24" height="36" viewBox="0 0 24 36"><path d="M12 2 5 28l7-6 7 6Z" fill="none" stroke="currentColor" strokeWidth=".8"/><path d="M12 2v32" stroke="currentColor" strokeWidth=".6"/></svg></div>
    <div className="plan-bottomline"><div className="plan-legend"><span><i className="legend-unit" />文件单元</span><span><i className="legend-selected" />选中模块</span><span><i className="legend-warning" />架构警告</span><span><i className="legend-healthy" />健康</span><span>→ 依赖方向</span></div><span className="plan-sheet">A—01 <b> / </b> {plan.groups.length} MODULES</span></div>
    <div className="plan-navigation"><span className="plan-navigation-hint">拖拽平移 · 滚轮缩放</span><div className="plan-zoom"><button aria-label="缩小地图" onClick={() => setZoom((v) => Math.max(.35, v / 1.2))}>−</button><output aria-label="地图缩放比例">{Math.round(scale * 100)}%</output><button aria-label="放大地图" onClick={() => setZoom((v) => Math.min(4, v * 1.2))}>＋</button><button onClick={reset} aria-label="适应画布" title="适应画布">⊡</button></div></div>
  </div>;
}
