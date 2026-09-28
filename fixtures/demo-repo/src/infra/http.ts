import { logger } from '@/utils/logger';

export interface HttpResult<T> {
  status: number;
  body: T;
}

export async function getJson<T>(url: string): Promise<HttpResult<T>> {
  logger.info(`GET ${url}`);
  return { status: 200, body: {} as T };
}
