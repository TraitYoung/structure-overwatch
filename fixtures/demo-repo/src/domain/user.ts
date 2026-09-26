import { z } from 'zod';
import { formatDate } from '@/utils/date';
import { formatMoney } from '@/utils/format/money';

const userSchema = z.object({ id: z.string(), name: z.string() });

export interface User {
  id: string;
  name: string;
  email?: string;
}

export function describeUser(user: User): string {
  userSchema.parse(user);
  return `${user.name}（注册于 ${formatDate('2024-01-01')}）`;
}
