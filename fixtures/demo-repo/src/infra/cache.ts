import { getJson } from './http';

export class Cache {
  private store = new Map<string, unknown>();

  async warm(url: string): Promise<void> {
    const res = await getJson<unknown>(url);
    this.store.set(url, res.body);
  }

  get(url: string): unknown {
    return this.store.get(url);
  }
}
