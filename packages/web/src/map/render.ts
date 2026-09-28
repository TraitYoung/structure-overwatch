import type { GraphEdge, GraphNode } from '@surv/shared';
import { mapSignals } from '../store/world';
import { provinceColor } from './colors';
import { HEX_DIRS, HEX_SIZE, hexAdd, hexCorners, hexKey, hexToWorld, type MapLayout } from './layout';

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  layout: MapLayout;
  nodes: ReadonlyMap<string, GraphNode>;
  edges: ReadonlyMap<string, GraphEdge>;
  selectedModuleId: string | null;
  view: ViewState;
  width: number;
  height: number;
  time: number;
  hoverFileId: string | null;
}

/** 聚合文件边为模块间道路权重 */
export function aggregateModuleRoads(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
): Array<{ from: string; to: string; weight: number }> {
  const agg = new Map<string, { from: string; to: string; weight: number }>();
  for (const e of edges.values()) {
    if (e.external) continue;
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to || from.kind !== 'file' || to.kind !== 'file') continue;
    if (!from.moduleId || !to.moduleId || from.moduleId === to.moduleId) continue;
    const key = `${from.moduleId}|${to.moduleId}`;
    const cur = agg.get(key);
    if (cur) cur.weight += 1;
    else agg.set(key, { from: from.moduleId, to: to.moduleId, weight: 1 });
  }
  return [...agg.values()];
}

function moduleMetricsOf(node: GraphNode | undefined) {
  return node?.metrics?.kind === 'module' ? node.metrics : undefined;
}

function traceHexPath(ctx: CanvasRenderingContext2D, corners: Array<{ x: number; y: number }>): void {
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
}

/** 沿省份外围描一圈边（内边不画）：color/width 由回调决定 */
function traceProvinceBorder(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  nodes: ReadonlyMap<string, GraphNode>,
  moduleId: string,
  toScreen: (x: number, y: number) => { x: number; y: number },
  stroke: () => void,
): void {
  const province = layout.provinces.get(moduleId);
  if (!province) return;
  for (const cell of province.cells) {
    const corners = hexCorners(cell).map((c) => toScreen(c.x, c.y));
    for (let k = 0; k < 6; k++) {
      const neighbor = hexAdd(cell, EDGE_NEIGHBORS[k]);
      const neighborFile = layout.cellToFile.get(hexKey(neighbor));
      if (neighborFile && nodes.get(neighborFile)?.moduleId === moduleId) continue;
      const c1 = corners[k];
      const c2 = corners[(k + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      stroke();
    }
  }
}

const EDGE_NEIGHBORS = HEX_DIRS;

export function drawMap(input: RenderInput): void {
  const { ctx, layout, nodes, edges, selectedModuleId, view, width, height, time, hoverFileId } = input;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#101218';
  ctx.fillRect(0, 0, width, height);

  const s = view.scale;
  const toScreen = (wx: number, wy: number) => ({ x: view.x + wx * s, y: view.y + wy * s });

  // ---- 省份填色（健康度泛红，循环省份泛紫） ----
  for (const p of layout.provinces.values()) {
    const color = provinceColor(p.name);
    const metrics = moduleMetricsOf(nodes.get(p.moduleId));
    const health = metrics?.health ?? 100;
    const cyclic = metrics?.cyclic ?? false;
    for (const cell of p.cells) {
      const corners = hexCorners(cell).map((c) => toScreen(c.x, c.y));
      traceHexPath(ctx, corners);
      ctx.fillStyle = color.fill;
      ctx.fill();
      if (health < 70) {
        ctx.fillStyle = `rgba(190, 30, 30, ${((70 - health) / 100) * 1.1})`;
        ctx.fill();
      } else if (cyclic) {
        ctx.fillStyle = 'rgba(150, 60, 160, 0.14)';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---- 跨省道路 ----
  ctx.lineCap = 'round';
  for (const road of aggregateModuleRoads(nodes, edges)) {
    const from = layout.provinces.get(road.from);
    const to = layout.provinces.get(road.to);
    if (!from || !to) continue;
    const a = toScreen(hexToWorld(from.center).x, hexToWorld(from.center).y);
    const b = toScreen(hexToWorld(to.center).x, hexToWorld(to.center).y);
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    const bow = Math.min(60, len * 0.16) * (road.weight % 2 === 0 ? 1 : -1);
    const cx = (a.x + b.x) / 2 + (nx / len) * bow;
    const cy = (a.y + b.y) / 2 + (ny / len) * bow;
    const widthPx = Math.min(9, 1.4 + Math.sqrt(road.weight) * 1.1) * Math.max(0.5, Math.min(1.6, s));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.strokeStyle = 'rgba(233, 196, 128, 0.5)';
    ctx.lineWidth = widthPx;
    ctx.stroke();
    // 商队流动虚线
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -(time / 40) % 1000;
    ctx.strokeStyle = 'rgba(255, 235, 190, 0.35)';
    ctx.lineWidth = Math.max(1, widthPx * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- 国境线 ----
  for (const p of layout.provinces.values()) {
    const color = provinceColor(p.name);
    for (const cell of p.cells) {
      const corners = hexCorners(cell).map((c) => toScreen(c.x, c.y));
      for (let k = 0; k < 6; k++) {
        const neighbor = hexAdd(cell, EDGE_NEIGHBORS[k]);
        const neighborFile = layout.cellToFile.get(hexKey(neighbor));
        if (neighborFile && nodes.get(neighborFile)?.moduleId === p.moduleId) continue;
        const c1 = corners[k];
        const c2 = corners[(k + 1) % 6];
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.strokeStyle = neighborFile ? color.border : 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = neighborFile ? 2.4 * Math.max(0.6, Math.min(1.5, s)) : 1.2;
        ctx.stroke();
      }
    }
  }

  // ---- 选中省份 ----
  if (selectedModuleId) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.6;
    traceProvinceBorder(ctx, layout, nodes, selectedModuleId, toScreen, () => ctx.stroke());
  }

  // ---- 边境冲突（红脉冲）----
  const now = time;
  const highlight = mapSignals.highlight;
  if (now < highlight.until && highlight.ids.size > 0) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 130);
    for (const moduleId of highlight.ids) {
      ctx.strokeStyle = `rgba(255, 64, 48, ${0.55 + 0.4 * pulse})`;
      ctx.lineWidth = 3.4 + 1.6 * pulse;
      traceProvinceBorder(ctx, layout, nodes, moduleId, toScreen, () => ctx.stroke());
    }
  }

  // ---- 变更脉冲 ----
  for (const [fileId, ts] of mapSignals.changes) {
    const cell = layout.fileToCell.get(fileId);
    if (!cell) continue;
    const age = (now - ts) / 900;
    if (age < 0 || age > 1) continue;
    const corners = hexCorners(cell, HEX_SIZE * (1 + age * 0.8)).map((c) => toScreen(c.x, c.y));
    traceHexPath(ctx, corners);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * (1 - age)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- 波及范围（右键文件触发）----
  const impact = mapSignals.impact;
  if (impact) {
    const paintCells = (ids: ReadonlySet<string>, color: string) => {
      for (const f of ids) {
        const cell = layout.fileToCell.get(f);
        if (!cell) continue;
        const corners = hexCorners(cell).map((c) => toScreen(c.x, c.y));
        traceHexPath(ctx, corners);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };
    paintCells(impact.downstream, 'rgba(255, 120, 60, 0.30)'); // 下游：暖色（会被炸到）
    paintCells(impact.upstream, 'rgba(90, 150, 255, 0.22)'); // 上游：冷色（供给链）
    const centerCell = layout.fileToCell.get(impact.fileId);
    if (centerCell) {
      const pulse = 0.6 + 0.4 * Math.sin(now / 220);
      const corners = hexCorners(centerCell, HEX_SIZE * (1.15 + 0.25 * pulse)).map((c) => toScreen(c.x, c.y));
      traceHexPath(ctx, corners);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
  }

  // ---- 省份标签 ----
  if (s >= 0.45) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of layout.provinces.values()) {
      const metrics = moduleMetricsOf(nodes.get(p.moduleId));
      const c = toScreen(hexToWorld(p.center).x, hexToWorld(p.center).y);
      const fs = Math.max(0.85, Math.min(1.4, s));
      ctx.font = `600 ${13 * fs}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(p.name, c.x, c.y - 7);
      ctx.fillStyle = '#f2ead8';
      ctx.fillText(p.name, c.x, c.y - 7);
      if (metrics) {
        const sub = `${metrics.files} 文件·${metrics.health}`;
        ctx.font = `${10 * fs}px system-ui, sans-serif`;
        ctx.strokeText(sub, c.x, c.y + 9);
        ctx.fillStyle = metrics.cyclic ? '#ff8f7a' : '#cfc4a8';
        ctx.fillText(sub, c.x, c.y + 9);
      }
    }
  }

  // ---- 波及分析 HUD ----
  if (impact) {
    const node = nodes.get(impact.fileId);
    const lines = [
      `波及分析 · ${node?.name ?? impact.fileId}`,
      `下游受影响 ${impact.downstream.size} 文件 · ${impact.modules.size} 省份`,
      `上游供给 ${impact.upstream.size} 文件`,
      '点击空白或按 Esc 关闭',
    ];
    const boxW = Math.max(...lines.map((l) => l.length)) * 6.8 + 24;
    const boxH = lines.length * 17 + 14;
    const bx = 18;
    const by = 70;
    ctx.fillStyle = 'rgba(12, 14, 20, 0.92)';
    ctx.strokeStyle = 'rgba(255, 140, 80, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#ffd9a8' : i === lines.length - 1 ? '#8b93a5' : '#b9c0cf';
      ctx.font = `${i === 0 ? 600 : 400} 11.5px ui-monospace, monospace`;
      ctx.fillText(l, bx + 12, by + 9 + i * 17);
    });
  }

  // ---- 悬停文件信息卡 ----
  if (hoverFileId) {
    const node = nodes.get(hoverFileId);
    if (node) {
      const mod = node.moduleId ? nodes.get(node.moduleId) : undefined;
      const lines = [node.path ?? node.id];
      if (node.metrics?.kind === 'file') {
        const m = node.metrics;
        lines.push(`行数 ${m.loc} · 复杂度 ${m.complexity} · 被引 ${m.fanIn} / 依赖 ${m.fanOut}`);
        lines.push(`健康 ${m.health} · 省份 ${mod?.name ?? '-'}`);
      }
      const boxW = Math.max(...lines.map((l) => l.length)) * 6.8 + 24;
      const boxH = lines.length * 17 + 14;
      const bx = width - boxW - 18;
      const by = 70;
      ctx.fillStyle = 'rgba(12, 14, 20, 0.92)';
      ctx.strokeStyle = 'rgba(226, 183, 105, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? '#f5efdd' : i === lines.length - 1 ? '#9be89b' : '#b9c0cf';
        ctx.font = `${i === 0 ? 600 : 400} 11.5px ui-monospace, monospace`;
        ctx.fillText(l, bx + 12, by + 9 + i * 17);
      });
    }
  }
}
