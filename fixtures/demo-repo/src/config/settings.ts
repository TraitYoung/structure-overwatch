import { logger } from '@/utils/logger';

export interface Settings {
  env: string;
  port: number;
}

export function loadSettings(): Settings {
  if (process.env.NODE_ENV === 'production') {
    logger.info('生产环境配置');
    return { env: 'production', port: 8080 };
  }
  return { env: 'development', port: 3000 };
}

export const flags = {
  darkMode: true,
};
