export function formatMoney(cents: number, currency = 'CNY'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = `${abs % 100}`.padStart(2, '0');
  if (currency === 'CNY') {
    return `${sign}¥${yuan}.${fen}`;
  }
  return `${sign}${yuan}.${fen} ${currency}`;
}
