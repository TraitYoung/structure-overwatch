import type { User } from '@/domain/user';
import { UserRepo } from './repo/userRepo';
import { AuditRepo } from './repo/auditRepo';

export class UserService {
  private repo = new UserRepo();
  private audit = new AuditRepo();

  currentUser(): User | null {
    return this.repo.find('u-001');
  }

  rename(id: string, name: string): boolean {
    const user = this.repo.find(id);
    if (user && this.audit.record(id, 'rename')) {
      user.name = name;
      return true;
    }
    return false;
  }
}
