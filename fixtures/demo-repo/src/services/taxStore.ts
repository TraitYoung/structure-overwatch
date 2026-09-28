import { taxApi } from './taxApi';
import { taxRateFor } from '@/utils/tax/taxRate';

const store = new Map<string, number>();

export function taxStore(region: string): string {
  const tag = `t:${region}`;
  if (!store.has(tag)) store.set(tag, taxRateFor(region));
  return `${tag}:${store.get(tag)}:${taxApi.submit(region, store.get(tag)!).length}`;
}
