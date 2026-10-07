export interface ColorThreshold {
  minimum: number;
  color: string;
}

export const coverageColors = [
  { minimum: 100, color: '#4c1' },
  { minimum: 75, color: '#97ca00' },
  { minimum: 50, color: '#dfb317' },
  { minimum: Number.MIN_VALUE, color: '#fe7d37' },
  { minimum: 0, color: '#e05d44' },
] as const;

const named: Record<string, string> = {
  blue: '#007ec6',
  brightgreen: '#4c1',
  green: '#97ca00',
  yellow: '#dfb317',
  orange: '#fe7d37',
  red: '#e05d44',
  grey: '#555',
  gray: '#555',
  purple: '#9f4f96',
};

export function customColor(value: string): string | undefined {
  return (
    (Object.hasOwn(named, value) ? named[value] : undefined) ??
    (/^[a-fA-F0-9]{6}$/.test(value) ? `#${value}` : undefined)
  );
}

export function automaticColor(
  coverage: number,
  thresholds: readonly ColorThreshold[] = coverageColors,
): string {
  return thresholds.find((entry) => coverage >= entry.minimum)?.color ?? '#555';
}
