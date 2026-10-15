import { existsSync } from 'node:fs';
import Fastify, { type FastifyError } from 'fastify';
import type { IncomingMessage } from 'node:http';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMessage } from '@surv/shared';
import type { AnalysisEngine } from '@surv/core';
import { ProjectManager, ProjectError, listDirectories } from './projects.js';

export interface StartServerOptions {
  repoRoot: string;
  port?: number;
  host?: string;
  webDist?: string | null;
  watch?: boolean;
  /** 最近项目记录文件；false 可关闭磁盘持久化。 */
  projectsFile?: string | false;
}

export interface RunningServer {
  port: number;
  readonly engine: AnalysisEngine;
  close: () => Promise<void>;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const projects = new ProjectManager({ watch: opts.watch, projectsFile: opts.projectsFile });
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const wss = new WebSocketServer({ server: app.server, path: '/ws', verifyClient: (info: { origin: string; req: IncomingMessage }, done: (allowed: boolean, code?: number, message?: string) => void) => {
    const origin = info.origin;
    const allowed = info.req.headers['sec-fetch-site'] !== 'cross-site' && (!origin || [`http://${info.req.headers.host}`, `https://${info.req.headers.host}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin));
    done(allowed, 403, 'Forbidden origin');
  } });
  const broadcast = (message: ServerMessage) => {
    const data = JSON.stringify(message);
    for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN) socket.send(data);
  };
  projects.on('message', broadcast);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // Local filesystem APIs accept only our own UI (including the Vite development origin).
    const origin = request.headers.origin;
    const allowed = new Set([`http://${request.headers.host}`, `https://${request.headers.host}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
    if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowed.has(origin))) {
      return reply.code(403).send({ message: '此接口仅供本地架构哨站界面使用。' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProjectError) return reply.code(error.statusCode).send({ message: error.message });
    const failure = error as FastifyError;
    if (failure.validation) return reply.code(400).send({ message: '请求参数无效，请提供完整的文件夹路径。' });
    return reply.code(failure.statusCode ?? 500).send({ message: '操作失败，请稍后重试。' });
  });
  if (opts.webDist && existsSync(opts.webDist)) await app.register(fastifyStatic, { root: opts.webDist });
  app.get('/api/snapshot', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return projects.snapshot();
  });
  app.get('/api/health', async () => ({ ok: true, repoRoot: projects.engine.repoRoot }));
  app.get('/api/projects', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return projects.list();
  });
  app.post<{ Body: { path: string } }>('/api/projects/open', {
    schema: { body: { type: 'object', required: ['path'], additionalProperties: false, properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } },
  }, async (request) => projects.open(request.body.path));
  app.get<{ Querystring: { path?: string } }>('/api/directories', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return listDirectories(request.query.path ?? projects.engine.repoRoot);
  });

  wss.on('connection', (socket) => {
    const snapshot = projects.snapshot();
    socket.send(JSON.stringify({ type: 'hello', sessionId: snapshot.sessionId, version: snapshot.version, status: snapshot.status } satisfies ServerMessage));
    socket.on('message', (raw) => {
      try {
        if (JSON.parse(String(raw)).type === 'ping' && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage));
      } catch { /* Ignore invalid client messages. */ }
    });
  });

  try {
    await projects.initialize(opts.repoRoot);
    await app.listen({ port: opts.port ?? 3210, host: opts.host ?? '127.0.0.1' });
  } catch (error) {
    await projects.close();
    wss.close();
    await app.close();
    throw error;
  }
  const address = app.server.address();
  return {
    port: typeof address === 'object' && address ? address.port : opts.port ?? 3210,
    get engine() { return projects.engine; },
    close: async () => {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
      await projects.close();
    },
  };
}
