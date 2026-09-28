import { taxReport } from '@/utils/tax/taxReport';
import type { TaxConfig } from '@/utils/tax/taxConfig';

export const taxApi = {
  submit(region: string, rate: number): string {
    return `submitted:${region}:${rate}`;
  },

  configSummary(cfg: TaxConfig): string {
    return `${cfg.region}@${cfg.rate}`;
  },

  all(regions: string[]): string[] {
    return taxReport(regions);
  },
};
