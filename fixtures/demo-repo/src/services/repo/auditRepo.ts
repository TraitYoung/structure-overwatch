import { logger } from '@/utils/logger';
import { AuthService } from '../authService';

export class AuditRepo {
  private auth = new AuthService();

  record(id: string, action: string): boolean {
    logger.debug(`审计 ${id} ${action}`);
    return this.auth.check();
  }
}
