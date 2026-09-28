import { taxRateFor } from './taxRate';
import { taxStore } from '@/services/taxStore';

export interface TaxConfig {
  region: string;
  rate: number;
  storeTag: string;
}

export function taxConfigFor(region: string): TaxConfig {
  return { region, rate: taxRateFor(region), storeTag: taxStore(region) };
}
