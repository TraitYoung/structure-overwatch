import { useEffect, useMemo, useRef } from 'react';
import { useWorld } from '../store/world';
import { computeLayout, hexToWorld, worldToHex, type MapLayout } from './layout';
import { drawMap, type ViewState } from './render';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function WorldMap(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 });
  const didFitRef = useRef(false);
  const layoutRef = useRef<MapLayout | null>(null);
  const hoverRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const pointerRef = useRef({ dragging: false, moved: 0, lastX: 0, lastY: 0 });

  const rev = useWorld((st) => st.rev);
  const nodes = useWorld((st) => st.nodes);

  // 增量布局：已分配格子保持不动，新文件追加空位
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
    const next = computeLayout(modules, layoutRef.current ?? undefined);
    layoutRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, nodes]);

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
      return { px, py, fileId, w, h };
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerRef.current = { dragging: true, moved: 0, lastX: e.clientX, lastY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointerRef.current;
      if (p.dragging) {
        const dx = e.clientX - p.lastX;
        const dy = e.clientY - p.lastY;
        p.moved += Math.abs(dx) + Math.abs(dy);
        p.lastX = e.clientX;
        p.lastY = e.clientY;
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        return;
      }
      hoverRef.current = locate(e).fileId;
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pointerRef.current;
      p.dragging = false;
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

    const onLeave = () => {
      hoverRef.current = null;
      pointerRef.current.dragging = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} className="map-wrap">
      <canvas ref={canvasRef} />
      <div className="map-hint">拖拽平移 · 滚轮缩放 · 单击选中省份 · 双击进入城市视图</div>
    </div>
  );
}
