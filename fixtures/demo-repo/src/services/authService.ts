import { AuditRepo } from './repo/auditRepo';
import { logger } from '@/utils/logger';

export class AuthService {
  private audit = new AuditRepo();

  check(): boolean {
    logger.debug('鉴权检查');
    return this.audit !== undefined;
  }
}
