import { logger } from '@/utils/logger';
import { AuditRepo } from './auditRepo';

export class UserRepo {
  constructor(private audit: AuditRepo = new AuditRepo()) {}

  find(id: string) {
    logger.debug(`查询用户 ${id}`);
    return { id, name: 'Ada', email: 'ada@example.com' };
  }

  save(id: string): boolean {
    if (!this.audit.record(id, 'save')) {
      return false;
    }
    return true;
  }
}
