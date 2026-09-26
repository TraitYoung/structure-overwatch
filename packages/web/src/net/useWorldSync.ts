import { useEffect } from 'react';
import { useWorld } from '../store/world';

/** 建立与后端的世界同步：REST 全量快照 + WebSocket 增量推送，断线自动重连 */
export function useWorldSync(): void {
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer = 0;

    const fetchSnapshot = async () => {
      const res = await fetch('/api/snapshot');
      if (!res.ok) throw new Error(`快照请求失败：${res.status}`);
      const snap = await res.json();
      if (!disposed) useWorld.getState().applySnapshot(snap);
    };

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => useWorld.getState().setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === 'hello') {
            // 连上时若本地版本落后（例如重连期间漏了 diff），重新拉快照
            if (useWorld.getState().loaded && msg.version !== useWorld.getState().version) void fetchSnapshot();
          } else if (msg.type === 'diff') {
            useWorld.getState().applyDiff(msg.diff, () => void fetchSnapshot());
          }
        } catch {
          /* 忽略无法解析的消息 */
        }
      };
      ws.onclose = () => {
        useWorld.getState().setConnected(false);
        retryTimer = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };

    void fetchSnapshot()
      .then(connect)
      .catch(() => {
        retryTimer = window.setTimeout(() => void fetchSnapshot().then(connect).catch(() => undefined), 2000);
      });

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
