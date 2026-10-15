import type { DirectoryListing, ProjectList } from '@surv/shared';

export const worldSyncEvents = new EventTarget();

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', ...options }); }
  catch { throw new Error('无法连接本地分析服务，请确认服务正在运行。'); }
  const body = await response.json().catch(() => { throw new Error('本地服务响应异常，请确认分析服务正在运行。'); });
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `请求失败 (${response.status})`);
  return body as T;
}

export function loadProjects(signal?: AbortSignal): Promise<ProjectList> {
  return request('/api/projects', { signal });
}

export async function openProject(path: string): Promise<void> {
  await request('/api/projects/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  // Fetch the latest server session rather than applying a potentially stale POST response.
  worldSyncEvents.dispatchEvent(new Event('refresh'));
}

export function browseDirectories(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
  return request(`/api/directories${path ? `?path=${encodeURIComponent(path)}` : ''}`, { signal });
}
