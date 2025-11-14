export function roundToFixed(val: number | string, decimals = 1): number {
  const value = typeof val === 'string' ? parseFloat(val) : val;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
