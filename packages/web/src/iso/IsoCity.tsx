import { useEffect, useRef } from 'react';
import { useWorld, mapSignals } from '../store/world';
import { provinceColor, healthColor } from '../map/colors';

interface Building {
  fileId: string;
  name: string;
  col: number;
  row: number;
  /** 占地格数边长：1 或 2 */
  span: number;
  height: number; // 像素单位（缩放前）
  health: number;
  loc: number;
  complexity: number;
}

const TILE_W = 54;
const TILE_H = 27;
const WALL_H = 15;

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

export function IsoCity(): JSX.Element | null {
  const isoOpen = useWorld((st) => st.isoOpen);
  const selectedModuleId = useWorld((st) => st.selectedModuleId);
  const nodes = useWorld((st) => st.nodes);
  const edges = useWorld((st) => st.edges);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ buildings: [] as Building[], byId: new Map<string, Building>(), selected: null as string | null, hover: null as string | null });

  const moduleNode = selectedModuleId ? nodes.get(selectedModuleId) : undefined;

  // 建筑布局（模块文件变化时重算；位置按路径顺序确定）
  useEffect(() => {
    if (!isoOpen || !selectedModuleId) return;
    const files = [...nodes.values()]
      .filter((n) => n.kind === 'file' && n.moduleId === selectedModuleId)
      .sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
    const cols = Math.max(3, Math.min(7, Math.ceil(Math.sqrt(files.length * 1.6))));
    const buildings: Building[] = [];
    const occupied = new Set<string>();
    let cursorCol = 0;
    let cursorRow = 0;
    for (const f of files) {
      const m = f.metrics?.kind === 'file' ? f.metrics : null;
      const loc = m?.loc ?? 0;
      const complexity = m?.complexity ?? 1;
      const health = m?.health ?? 100;
      const span = loc > 420 ? 2 : 1;
      // 找下一个可放位置（行优先，2x2 需要整块空）
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const fits = (c: number, r: number) => {
          for (let dc = 0; dc < span; dc++) {
            for (let dr = 0; dr < span; dr++) {
              if (occupied.has(`${c + dc},${r + dr}`)) return false;
            }
          }
          return true;
        };
        if (cursorCol + span > cols) {
          cursorCol = 0;
          cursorRow += 1;
          continue;
        }
        if (fits(cursorCol, cursorRow)) {
          for (let dc = 0; dc < span; dc++) {
            for (let dr = 0; dr < span; dr++) occupied.add(`${cursorCol + dc},${cursorRow + dr}`);
          }
          break;
        }
        cursorCol += 1;
      }
      buildings.push({
        fileId: f.id,
        name: f.name ?? f.id,
        col: cursorCol,
        row: cursorRow,
        span,
        height: Math.max(WALL_H, Math.min(WALL_H * 8, WALL_H * (1 + complexity / 6))),
        health,
        loc,
        complexity,
      });
      cursorCol += span;
    }
    stateRef.current = {
      buildings,
      byId: new Map(buildings.map((b) => [b.fileId, b])),
      selected: null,
      hover: null,
    };
  }, [isoOpen, selectedModuleId, nodes]);

  // 渲染循环
  useEffect(() => {
    if (!isoOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0d0f15';
      ctx.fillRect(0, 0, W, H);

      const { buildings, byId, selected, hover } = stateRef.current;
      if (buildings.length === 0) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // 缩放适配
      const maxCol = Math.max(...buildings.map((b) => b.col + b.span)) + 1;
      const maxRow = Math.max(...buildings.map((b) => b.row + b.span)) + 1;
      const scale = Math.min(1.3, Math.min(W / (maxCol * TILE_W + 80), H / (maxRow * TILE_H + 260)));
      const originX = W / 2;
      const originY = 90;
      const tileToScreen = (c: number, r: number) => ({
        x: originX + (c - r) * (TILE_W / 2) * scale,
        y: originY + (c + r) * (TILE_H / 2) * scale,
      });

      // 地基
      for (const b of buildings) {
        for (let dc = 0; dc < b.span; dc++) {
          for (let dr = 0; dr < b.span; dr++) {
            const p = tileToScreen(b.col + dc, b.row + dr);
            diamond(ctx, p.x, p.y, TILE_W * scale, TILE_H * scale);
            ctx.fillStyle = 'rgba(60, 62, 72, 0.55)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // 内部道路（模块内文件间 import；选中建筑时高亮其道路）
      const now = performance.now();
      for (const e of edges.values()) {
        if (e.external) continue;
        const from = byId.get(e.from);
        const to = byId.get(e.to);
        if (!from || !to) continue;
        const a = tileToScreen(from.col + from.span / 2, from.row + from.span / 2);
        const b = tileToScreen(to.col + to.span / 2, to.row + to.span / 2);
        const active = selected === e.from || selected === e.to;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = active ? 'rgba(255, 226, 150, 0.95)' : 'rgba(233, 196, 128, 0.35)';
        ctx.lineWidth = active ? 2.4 : 1.4;
        ctx.stroke();
      }

      // 建筑（按深度排序：row+col 小的先画）
      const sorted = [...buildings].sort((a, b) => a.col + a.row - (b.col + b.row));
      for (const b of sorted) {
        const base = tileToScreen(b.col, b.row);
        const cx = base.x;
        const cy = base.y;
        const w = TILE_W * b.span * scale - 6 * scale;
        const d = TILE_H * b.span * scale - 3 * scale;
        const h = b.height * scale;
        const color = healthColor(b.health);
        const hue = color;

        // 左墙（暗）
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx, cy + d / 2);
        ctx.lineTo(cx, cy + d / 2 - h);
        ctx.lineTo(cx - w / 2, cy - h);
        ctx.closePath();
        ctx.fillStyle = shade(hue, -28);
        ctx.fill();
        // 右墙（中）
        ctx.beginPath();
        ctx.moveTo(cx + w / 2, cy);
        ctx.lineTo(cx, cy + d / 2);
        ctx.lineTo(cx, cy + d / 2 - h);
        ctx.lineTo(cx + w / 2, cy - h);
        ctx.closePath();
        ctx.fillStyle = shade(hue, -12);
        ctx.fill();
        // 屋顶（亮）
        diamond(ctx, cx, cy - h, w, d);
        ctx.fillStyle = shade(hue, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 交互态
        if (hover === b.fileId || selected === b.fileId) {
          diamond(ctx, cx, cy - h, w + 6 * scale, d + 3 * scale);
          ctx.strokeStyle = selected === b.fileId ? '#9be89b' : '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // 近期变更发光
        const ts = mapSignals.changes.get(b.fileId);
        if (ts && now - ts < 4000) {
          const glow = 1 - (now - ts) / 4000;
          ctx.save();
          ctx.shadowColor = `rgba(255,255,255,${0.8 * glow})`;
          ctx.shadowBlur = 14 * glow;
          diamond(ctx, cx, cy - h, w, d);
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * glow})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.restore();
        }

        // 楼层高时显示层标记
        if (b.complexity > 20) {
          ctx.font = `600 ${9 * Math.min(1, scale + 0.3)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillText('⚠', cx, cy - h - 8);
        }
      }

      // 悬停提示
      const hoverId = stateRef.current.hover;
      if (hoverId) {
        const b = byId.get(hoverId);
        const node = nodes.get(hoverId);
        if (b && node) {
          const lines = [
            node.path ?? node.id,
            `行数 ${b.loc} · 复杂度 ${b.complexity} · 健康 ${b.health}`,
            `被引 ${node.metrics?.kind === 'file' ? node.metrics.fanIn : '-'} · 依赖 ${node.metrics?.kind === 'file' ? node.metrics.fanOut : '-'}`,
          ];
          const boxW = Math.max(...lines.map((l) => l.length)) * 6.8 + 24;
          const boxH = lines.length * 17 + 14;
          const bx = 14;
          const by = H - boxH - 14;
          ctx.fillStyle = 'rgba(12, 14, 20, 0.92)';
          ctx.strokeStyle = 'rgba(226, 183, 105, 0.5)';
          ctx.beginPath();
          ctx.roundRect(bx, by, boxW, boxH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          lines.forEach((l, i) => {
            ctx.fillStyle = i === 0 ? '#f5efdd' : '#b9c0cf';
            ctx.font = `${i === 0 ? 600 : 400} 11.5px ui-monospace, monospace`;
            ctx.fillText(l, bx + 12, by + 9 + i * 17);
          });
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isoOpen, edges, nodes]);

  // 命中检测：点到建筑屋顶菱形附近
  const onCanvasMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { buildings } = stateRef.current;
    if (buildings.length === 0) return;
    const maxCol = Math.max(...buildings.map((b) => b.col + b.span)) + 1;
    const maxRow = Math.max(...buildings.map((b) => b.row + b.span)) + 1;
    const W = rect.width;
    const H = rect.height;
    const scale = Math.min(1.3, Math.min(W / (maxCol * TILE_W + 80), H / (maxRow * TILE_H + 260)));
    const originX = W / 2;
    const originY = 90;
    let hit: string | null = null;
    let bestZ = -1;
    for (const b of buildings) {
      const px = originX + (b.col + b.span / 2 - (b.row + b.span / 2)) * (TILE_W / 2) * scale;
      const py = originY + (b.col + b.span / 2 + b.row + b.span / 2) * (TILE_H / 2) * scale;
      const dx = Math.abs(mx - px) / ((TILE_W * b.span * scale) / 2);
      const dy = Math.abs(my - py) / ((TILE_H * b.span * scale) / 2);
      if (dx + dy <= 1.2) {
        const z = b.col + b.row;
        if (z > bestZ) {
          bestZ = z;
          hit = b.fileId;
        }
      }
    }
    stateRef.current.hover = hit;
  };

  const onCanvasClick = () => {
    const st = stateRef.current;
    st.selected = st.hover;
  };

  if (!isoOpen || !moduleNode) return null;
  const metrics = moduleNode.metrics?.kind === 'module' ? moduleNode.metrics : null;
  const color = provinceColor(moduleNode.name);

  return (
    <div className="iso-overlay" onClick={(e) => e.target === e.currentTarget && useWorld.getState().setIsoOpen(false)}>
      <div className="iso-window">
        <div className="iso-header" style={{ borderColor: color.border }}>
          <div className="iso-title">
            <span className="iso-dot" style={{ background: color.bright }} />
            省份 {moduleNode.name}
            {metrics && (
              <span className="iso-stats">
                {metrics.files} 建筑 · {metrics.loc} 行 · 健康 {metrics.health}
                {metrics.cyclic ? ' · 处于循环' : ''}
              </span>
            )}
          </div>
          <button className="iso-close" onClick={() => useWorld.getState().setIsoOpen(false)}>
            ✕ 返回地图
          </button>
        </div>
        <canvas
          ref={canvasRef}
          className="iso-canvas"
          onPointerMove={onCanvasMove}
          onPointerLeave={() => (stateRef.current.hover = null)}
          onClick={onCanvasClick}
        />
        <div className="iso-legend">
          建筑高度 = 复杂度 · 颜色 = 健康度 · 大占地 = 长文件（&gt;420 行）· 金线 = 模块内依赖 · 点击建筑查看其道路
        </div>
      </div>
    </div>
  );
}

/** hsl 字符串明度微调：delta 为百分比偏移 */
function shade(hsl: string, delta: number): string {
  const m = /hsl\((\d+(?:\.\d+)?),\s*(\d+)%,\s*(\d+(?:\.\d+)?)%\)/.exec(hsl);
  if (!m) return hsl;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Math.max(4, Math.min(96, Number(m[3]) + delta));
  return `hsl(${h}, ${s}%, ${l.toFixed(0)}%)`;
}
