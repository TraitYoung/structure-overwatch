import { loadSettings, flags } from '@/config/settings';

export class Db {
  readonly connection = `db://${loadSettings().env}:${flags.darkMode}`;

  query(sql: string) {
    return { sql, rows: [] };
  }
}
