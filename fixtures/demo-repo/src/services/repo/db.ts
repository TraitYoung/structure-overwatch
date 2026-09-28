import { loadSettings, flags } from '@/config/settings';
import { Cache } from '@/infra/cache';
import { getJson } from '@/infra/http';

export class Db {
  readonly cache = new Cache();
  readonly connection = `db://${loadSettings().env}:${flags.darkMode}`;

  query(sql: string) {
    return { sql, rows: [] };
  }

  async prefetch(url: string) {
    await getJson<unknown>(url);
    return this.cache.get(url);
  }
}
