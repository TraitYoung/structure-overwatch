import { taxConfigFor, type TaxConfig } from './taxConfig';
import { taxRateFor } from './taxRate';
import { taxApi } from '@/services/taxApi';

export function taxReport(regions: string[]): string[] {
  return regions.map((r) => {
    const cfg: TaxConfig = taxConfigFor(r);
    return taxApi.submit(cfg.region, cfg.rate);
  });
}

export function averageRate(regions: string[]): number {
  if (regions.length === 0) return 0;
  return regions.reduce((s, r) => s + taxRateFor(r), 0) / regions.length;
}
