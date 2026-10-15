import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import type { DirectoryListing, ProjectList, ProjectSnapshot, ServerMessage } from '@surv/shared';
import { startServer, type RunningServer } from './index.js';
import { ProjectManager } from './projects.js';

async function fixtures() {
  const root = await mkdtemp(join(tmpdir(), 'survallian-projects-'));
  const a = join(root, '项目 A'), b = join(root, '项目 B');
  for (const [path, name] of [[a, 'project-a'], [b, 'project-b']]) {
    await mkdir(join(path, 'src'), { recursive: true });
    await writeFile(join(path, 'package.json'), JSON.stringify({ name }));
    await writeFile(join(path, 'src/index.ts'), `export const name = '${name}';`);
  }
  return { root, a, b, history: join(root, 'state/projects.json') };
}

const base = (server: RunningServer) => `http://127.0.0.1:${server.port}`;
async function snapshot(server: RunningServer): Promise<ProjectSnapshot> {
  return fetch(`${base(server)}/api/snapshot`).then((r) => r.json()) as Promise<ProjectSnapshot>;
}
async function open(server: RunningServer, path: string) {
  return fetch(`${base(server)}/api/projects/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
}
async function until<T>(read: () => T | Promise<T>, predicate: (value: T) => boolean, message = 'condition timed out'): Promise<T> {
  for (let i = 0; i < 160; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error(message);
}

async function client(server: RunningServer) {
  const messages: ServerMessage[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, messages };
}

test('open, validate, canonicalize and persist real projects without losing the current session on failure', async () => {
  const f = await fixtures();
  let server = await startServer({ repoRoot: f.a, port: 0, watch: false, projectsFile: f.history });
  try {
    const first = await until(() => snapshot(server), (s) => s.status.state === 'watching');
    assert.equal(first.repoName, 'project-a');
    for (const path of [join(f.root, 'missing'), join(f.a, 'package.json'), 'relative/path']) {
      assert.equal((await open(server, path)).status, 400);
      assert.equal((await snapshot(server)).sessionId, first.sessionId);
    }
    const same = await (await open(server, join(f.a, '.'))).json() as ProjectSnapshot;
    assert.equal(same.sessionId, first.sessionId);
    assert.equal((await open(server, f.b)).status, 200);
    const second = await until(() => snapshot(server), (s) => s.status.state === 'watching');
    assert.equal(second.repoName, 'project-b');
    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(server.engine.repoRoot, second.repoRoot);
    await server.close();
    server = await startServer({ repoRoot: f.a, port: 0, watch: false, projectsFile: f.history });
    const list = await fetch(`${base(server)}/api/projects`).then((r) => r.json()) as ProjectList;
    assert.equal(list.current?.name, 'project-a');
    assert.deepEqual(new Set(list.projects.map((p) => p.name)), new Set(['project-a', 'project-b']));
    assert.equal(list.projects.length, 2);
  } finally { await server.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('all clients follow project switches; only the new watcher publishes changes', async () => {
  const f = await fixtures();
  const server = await startServer({ repoRoot: f.a, port: 0, projectsFile: false });
  const one = await client(server), two = await client(server);
  try {
    const first = await until(() => snapshot(server), (s) => s.status.state === 'watching');
    await open(server, f.b);
    const second = await until(() => snapshot(server), (s) => s.status.state === 'watching' && s.repoName === 'project-b');
    for (const c of [one, two]) {
      await until(() => c.messages, (messages) => messages.some((m) => m.type === 'snapshot' && m.snapshot.sessionId === second.sessionId));
      c.messages.length = 0;
    }
    await writeFile(join(f.a, 'src/old.ts'), 'export const oldProject = true;');
    await writeFile(join(f.b, 'src/new.ts'), 'export const newProject = true;');
    for (const c of [one, two]) {
      await until(() => c.messages, (messages) => messages.some((m) => m.type === 'diff' && m.sessionId === second.sessionId && m.diff.nodesUpserted.some((n) => n.id === 'src/new.ts')));
      assert.ok(!c.messages.some((m) => m.type === 'diff' && m.sessionId === first.sessionId));
    }
    const live = await snapshot(server);
    assert.ok(live.nodes.some((n) => n.id === 'src/new.ts'));
    assert.ok(!live.nodes.some((n) => n.id === 'src/old.ts'));
  } finally {
    one.socket.terminate(); two.socket.terminate();
    await server.close(); await rm(f.root, { recursive: true, force: true });
  }
});

test('concurrent switches yield separate sessions and a consistent final world', async () => {
  const f = await fixtures();
  const projects = new ProjectManager({ watch: false, projectsFile: false });
  await projects.initialize(f.a);
  try {
    const worlds = await Promise.all([projects.open(f.b), projects.open(f.a)]);
    assert.equal(worlds[0].repoName, 'project-b');
    assert.equal(worlds[1].repoName, 'project-a');
    assert.notEqual(worlds[0].sessionId, worlds[1].sessionId);
    const current = await until(() => projects.snapshot(), (s) => s.status.state === 'watching');
    assert.equal(current.sessionId, worlds[1].sessionId);
  } finally { await projects.close(); await rm(f.root, { recursive: true, force: true }); }
});

test('directory browser lists folders and rejects invalid paths and foreign website requests', async () => {
  const f = await fixtures();
  const server = await startServer({ repoRoot: f.a, port: 0, watch: false, projectsFile: false });
  try {
    const listing = await fetch(`${base(server)}/api/directories?path=${encodeURIComponent(f.root)}`).then((r) => r.json()) as DirectoryListing;
    assert.equal(listing.directories.length, 2);
    assert.ok(listing.parent);
    assert.ok(listing.roots.length > 0);
    assert.equal((await fetch(`${base(server)}/api/directories?path=relative`)).status, 400);
    const denied = await fetch(`${base(server)}/api/projects/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: JSON.stringify({ path: f.b }) });
    assert.equal(denied.status, 403);
    assert.equal((await snapshot(server)).repoName, 'project-a');
    const forbidden = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { origin: 'https://unrelated.example' });
    forbidden.on('error', () => undefined);
    const status = await new Promise<number>((resolve) => forbidden.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!); }));
    assert.equal(status, 403);
    forbidden.terminate();
  } finally { await server.close(); await rm(f.root, { recursive: true, force: true }); }
});
