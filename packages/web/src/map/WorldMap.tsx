import { useEffect, useMemo, useRef } from 'react';
import { mapSignals, useWorld } from '../store/world';
import { computeLayout, hexToWorld, moveProvince, worldToHex, type Axial, type MapLayout } from './layout';
import { drawMap, type ViewState } from './render';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 手动摆位持久化：按仓库名记住省份原点，刷新页面后恢复 */
const layoutStoreKey = (repo: string) => `survallian.mapLayout:${repo}`;

function loadOverrides(repo: string): Record<string, Axial> {
  if (!repo) return {};
  try {
    const raw = localStorage.getItem(layoutStoreKey(repo));
    return raw ? (JSON.parse(raw) as Record<string, Axial>) : {};
  } catch {
    return {};
  }
}

function saveOverride(repo: string, moduleId: string, origin: Axial): void {
  if (!repo) return;
  try {
    const all = loadOverrides(repo);
    all[moduleId] = origin;
    localStorage.setItem(layoutStoreKey(repo), JSON.stringify(all));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为会话内记忆
  }
}

interface PointerState {
  mode: 'pan' | 'province' | null;
  moved: number;
  lastX: number;
  lastY: number;
  moduleId?: string;
  startOrigin?: Axial;
  startHex?: Axial;
}

export function WorldMap(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 });
  const didFitRef = useRef(false);
  const layoutRef = useRef<MapLayout | null>(null);
  const hoverRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const pointerRef = useRef<PointerState>({ mode: null, moved: 0, lastX: 0, lastY: 0 });

  const rev = useWorld((st) => st.rev);
  const nodes = useWorld((st) => st.nodes);
  const repoName = useWorld((st) => st.repoName);

  // 增量布局：已分配格子保持不动，新文件追加空位；随后套用用户手动摆位
  const layout = useMemo(() => {
    const modules = [...nodes.values()]
      .filter((n) => n.kind === 'module')
      .map((m) => ({
        moduleId: m.id,
        name: m.name,
        files: [...nodes.values()].filter((n) => n.kind === 'file' && n.moduleId === m.id)
          .map((n) => n.id)
          .sort(),
      }))
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId));
    let next = computeLayout(modules, layoutRef.current ?? undefined);
    for (const [id, origin] of Object.entries(loadOverrides(repoName))) {
      const cur = next.provinces.get(id);
      if (!cur || (cur.origin.q === origin.q && cur.origin.r === origin.r)) continue;
      next = moveProvince(next, id, origin) ?? next;
    }
    layoutRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, nodes, repoName]);

  // 画布尺寸自适应（含 DPR）
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // 渲染循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;
      const layoutNow = layoutRef.current;
      if (layoutNow && w > 0 && h > 0) {
        // 首帧适配视野
        if (!didFitRef.current && layoutNow.provinces.size > 0) {
          const { minQ, maxQ, minR, maxR } = layoutNow.bounds;
          const a = hexToWorld({ q: minQ, r: minR });
          const b = hexToWorld({ q: maxQ, r: maxR });
          const worldW = b.x - a.x + 90;
          const worldH = b.y - a.y + 90;
          const scale = clamp(Math.min(w / worldW, h / worldH), 0.3, 2);
          viewRef.current = {
            scale,
            x: w / 2 - ((a.x + b.x) / 2) * scale,
            y: h / 2 - ((a.y + b.y) / 2) * scale,
          };
          didFitRef.current = true;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const st = useWorld.getState();
        drawMap({
          ctx,
          layout: layoutNow,
          nodes: st.nodes,
          edges: st.edges,
          selectedModuleId: st.selectedModuleId,
          view: viewRef.current,
          width: w,
          height: h,
          time: performance.now(),
          hoverFileId: hoverRef.current,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 指针交互：拖拽平移、滚轮缩放、hover、单击选中、双击下钻
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const locate = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      const { w, h } = sizeRef.current;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = viewRef.current;
      const wx = (px - v.x) / v.scale;
      const wy = (py - v.y) / v.scale;
      const cell = worldToHex(wx, wy);
      const fileId = layoutRef.current?.cellToFile.get(`${cell.q},${cell.r}`) ?? null;
      return { px, py, wx, wy, fileId, w, h };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // 右键留给波及分析
      const { wx, wy, fileId } = locate(e);
      const moduleId = fileId ? useWorld.getState().nodes.get(fileId)?.moduleId : null;
      const province = moduleId ? layoutRef.current?.provinces.get(moduleId) : undefined;
      if (moduleId && province) {
        pointerRef.current = {
          mode: 'province',
          moved: 0,
          lastX: e.clientX,
          lastY: e.clientY,
          moduleId,
          startOrigin: { ...province.origin },
          startHex: worldToHex(wx, wy),
        };
        canvas.style.cursor = 'grabbing';
      } else {
        pointerRef.current = { mode: 'pan', moved: 0, lastX: e.clientX, lastY: e.clientY };
      }
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointerRef.current;
      if (p.mode === 'province' && p.moduleId && p.startOrigin && p.startHex && layoutRef.current) {
        p.moved += Math.abs(e.clientX - p.lastX) + Math.abs(e.clientY - p.lastY);
        p.lastX = e.clientX;
        p.lastY = e.clientY;
        const { wx, wy } = locate(e);
        const now = worldToHex(wx, wy);
        const target = {
          q: p.startOrigin.q + (now.q - p.startHex.q),
          r: p.startOrigin.r + (now.r - p.startHex.r),
        };
        // 省份是刚体：目标位置压到别的省份时保持原位不动
        layoutRef.current = moveProvince(layoutRef.current, p.moduleId, target) ?? layoutRef.current;
        return;
      }
      if (p.mode === 'pan') {
        const dx = e.clientX - p.lastX;
        const dy = e.clientY - p.lastY;
        p.moved += Math.abs(dx) + Math.abs(dy);
        p.lastX = e.clientX;
        p.lastY = e.clientY;
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        return;
      }
      const { fileId } = locate(e);
      hoverRef.current = fileId;
      canvas.style.cursor = fileId ? 'grab' : '';
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = pointerRef.current;
      const wasProvinceDrag = p.mode === 'province' && p.moved > 5;
      p.mode = null;
      canvas.style.cursor = '';
      mapSignals.impact = null; // 单击清除波及高亮
      if (wasProvinceDrag && p.moduleId) {
        const origin = layoutRef.current?.provinces.get(p.moduleId)?.origin;
        if (origin) saveOverride(useWorld.getState().repoName, p.moduleId, origin);
        return; // 真实拖拽，不视为点击
      }
      if (p.moved > 5) return; // 拖拽结束，不视为点击
      const { fileId } = locate(e);
      const st = useWorld.getState();
      if (fileId) {
        const node = st.nodes.get(fileId);
        if (node?.moduleId) {
          st.selectModule(node.moduleId);
          return;
        }
      }
      st.selectModule(null);
    };

    const onDblClick = (e: MouseEvent) => {
      const { fileId } = locate(e);
      const st = useWorld.getState();
      if (fileId) {
        const node = st.nodes.get(fileId);
        if (node?.moduleId) {
          st.selectModule(node.moduleId);
          st.setIsoOpen(true);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const ns = clamp(v.scale * factor, 0.25, 3);
      v.x = mx - (mx - v.x) * (ns / v.scale);
      v.y = my - (my - v.y) * (ns / v.scale);
      v.scale = ns;
    };

    // 右键文件 → 波及分析：BFS 算上下游影响半径（纯前端，边数据已在本地）
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const { fileId } = locate(e);
      if (!fileId) {
        mapSignals.impact = null;
        return;
      }
      const st = useWorld.getState();
      const fwd = new Map<string, string[]>();
      const rev = new Map<string, string[]>();
      const push = (m: Map<string, string[]>, k: string, v: string) => {
        const list = m.get(k);
        if (list) list.push(v);
        else m.set(k, [v]);
      };
      for (const edge of st.edges.values()) {
        if (edge.external) continue;
        push(fwd, edge.from, edge.to);
        push(rev, edge.to, edge.from);
      }
      const bfs = (start: string, adj: Map<string, string[]>): Set<string> => {
        const seen = new Set<string>([start]);
        const queue = [start];
        for (let head = 0; head < queue.length; head++) {
          for (const next of adj.get(queue[head]) ?? []) {
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        seen.delete(start);
        return seen;
      };
      const downstream = bfs(fileId, rev);
      const upstream = bfs(fileId, fwd);
      const modules = new Set<string>();
      for (const f of downstream) {
        const m = st.nodes.get(f)?.moduleId;
        if (m) modules.add(m);
      }
      mapSignals.impact = { fileId, downstream, upstream, modules };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') mapSignals.impact = null;
    };

    const onLeave = () => {
      hoverRef.current = null;
      pointerRef.current.mode = null;
      canvas.style.cursor = '';
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div ref={wrapRef} className="map-wrap">
      <canvas ref={canvasRef} />
      <div className="map-hint">拖拽省份移动 · 空白拖拽平移 · 右键文件看波及范围 · 单击选中 · 双击进入城市视图</div>
    </div>
  );
}
