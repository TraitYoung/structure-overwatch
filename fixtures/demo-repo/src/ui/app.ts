import { Panel } from './panel';
import { UserService } from '@/services/userService';
import { logger } from '@/utils/logger';
import type { User } from '@/domain/user';

export function renderApp(svc: UserService) {
  const user: User | null = svc.currentUser();
  logger.debug('渲染主界面');
  if (user) {
    new Panel(user).render();
  }
}
