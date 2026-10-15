import { useEffect } from 'react';
import type { ProjectSnapshot, ServerMessage } from '@surv/shared';
import { useWorld } from '../store/world';
import { worldSyncEvents } from './projects';

/** Session-scoped REST snapshots and WebSocket updates; late responses never cross project boundaries. */
export function useWorldSync(): void {
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer = 0;
    let snapshotRetry = 0;
    let generation = 0;
    let session: string | null = null;
    const controller = new AbortController();

    const fetchSnapshot = async (expectedSession?: string) => {
      const request = ++generation;
      try {
        const response = await fetch('/api/snapshot', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('快照请求失败');
        const snapshot: ProjectSnapshot = await response.json();
        if (disposed || request !== generation || (expectedSession && snapshot.sessionId !== expectedSession)) return;
        session = snapshot.sessionId;
        useWorld.getState().applySnapshot(snapshot);
      } catch {
        if (!disposed && request === generation) {
          window.clearTimeout(snapshotRetry);
          snapshotRetry = window.setTimeout(() => void fetchSnapshot(), 2000);
        }
      }
    };
    const refresh = () => void fetchSnapshot();

    const connect = () => {
      if (disposed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${location.host}/ws`);
      ws = socket;
      socket.onopen = () => { if (!disposed) useWorld.getState().setConnected(true); };
      socket.onmessage = (event) => {
        if (disposed || ws !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === 'hello') {
            session = message.sessionId;
            void fetchSnapshot(message.sessionId);
          } else if (message.type === 'snapshot') {
            ++generation;
            session = message.snapshot.sessionId;
            useWorld.getState().applySnapshot(message.snapshot);
          } else if (message.type === 'diff') {
            if (message.sessionId !== session || message.sessionId !== useWorld.getState().sessionId) return;
            if (message.diff.fromVersion === useWorld.getState().version) ++generation;
            useWorld.getState().applyDiff(message.diff, () => void fetchSnapshot(message.sessionId));
          }
        } catch { /* Ignore malformed messages; reconnect always fetches a fresh snapshot. */ }
      };
      socket.onclose = () => {
        if (disposed || ws !== socket) return;
        useWorld.getState().setConnected(false);
        retryTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };

    worldSyncEvents.addEventListener('refresh', refresh);
    void fetchSnapshot();
    connect();
    return () => {
      disposed = true;
      ++generation;
      controller.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(snapshotRetry);
      worldSyncEvents.removeEventListener('refresh', refresh);
      ws?.close();
    };
  }, []);
}
