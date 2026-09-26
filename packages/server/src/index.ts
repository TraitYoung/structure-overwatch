import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ServerMessage, WorldDiff } from '@surv/shared';
import { AnalysisEngine } from '@surv/core';
import { startWatcher } from '@surv/core';

export interface StartServerOptions {
  repoRoot: string;
  port?: number;
  host?: string;
  /** web 构建产物目录；存在则托管（生产模式），不存在则只提供 API（配合 Vite dev server） */
  webDist?: string | null;
  /** 是否启动文件监听（测试时可关闭） */
  watch?: boolean;
}

export interface RunningServer {
  port: number;
  engine: AnalysisEngine;
  close: () => Promise<void>;
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const port = opts.port ?? 3210;
  const host = opts.host ?? '127.0.0.1';

  const engine = new AnalysisEngine(opts.repoRoot);
  const app = Fastify({ logger: false });

  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist });
  }

  app.get('/api/snapshot', async () => engine.store.snapshot());
  app.get('/api/health', async () => ({ ok: true, repoRoot: opts.repoRoot }));

  await app.listen({ port, host });
  const httpServer = app.server as Server;

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (socket) => {
    const hello: ServerMessage = {
      type: 'hello',
      version: engine.store.snapshot().version,
      status: engine.store.getStatus(),
    };
    if (isOpen(socket)) socket.send(JSON.stringify(hello));

    const onDiff = (diff: WorldDiff) => {
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'diff', diff } satisfies ServerMessage));
    };
    engine.store.on('diff', onDiff);
    socket.on('close', () => engine.store.off('diff', onDiff));
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === 'ping' && isOpen(socket)) socket.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
      } catch {
        /* 忽略非法消息 */
      }
    });
  });

  // 后台开始首扫；文件监听立即启动，避免扫描期间的事件丢失（引擎队列会串行消化）
  if (opts.watch !== false) {
    startWatcher(opts.repoRoot, (events) => engine.enqueueFileEvents(events));
  }
  void engine.initialScan().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    engine.store.setStatus({ state: 'error', message });
    engine.store.pushEvent({ kind: 'info', severity: 'high', message: `扫描失败：${message}` });
  });

  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: actualPort,
    engine,
    close: async () => {
      wss.close();
      await app.close();
    },
  };
}
