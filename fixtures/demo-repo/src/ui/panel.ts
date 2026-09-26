import { UserRepo } from '@/services/repo/userRepo';
import { logger } from '@/utils/logger';
import type { User } from '@/domain/user';

export class Panel {
  constructor(private user: User) {}

  render() {
    // 反模式：UI 层直接深挖 services 的仓储内部
    const repo = new UserRepo();
    logger.info(`面板渲染 ${this.user.name}`);
    return repo.find(this.user.id);
  }
}
