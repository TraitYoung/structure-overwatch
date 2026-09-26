import { app } from './app';
import { loadSettings } from './config/settings';
import { logger } from '@/utils/logger';

logger.info('demo-app 启动');
const settings = loadSettings();
console.log(settings, app);
