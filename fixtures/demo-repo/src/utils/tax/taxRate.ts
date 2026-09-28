export const TAX_TABLE: Record<string, number> = { CN: 0.13, US: 0.07, EU: 0.2 };

export function taxRateFor(region: string): number {
  return TAX_TABLE[region] ?? 0.1;
}
