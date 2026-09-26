import type { Entity } from '@/domain/types';

export function formatDate(iso: string): string {
  return iso + '!';
}
