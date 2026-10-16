export const NUMERIC_JERSEY_SIZES = [
  '38',
  '40',
  '42',
  '44',
  '46',
  '48',
  '50',
  '52',
] as const;

export type NumericJerseySize = (typeof NUMERIC_JERSEY_SIZES)[number];

export const LEGACY_JERSEY_SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL'] as const;

export type LegacyJerseySize = (typeof LEGACY_JERSEY_SIZES)[number];

export type JerseySize = NumericJerseySize | LegacyJerseySize;

/**
 * Authoritative business mapping defined in the application:
 * Small (S - 38") -> 38
 * Medium (M - 40") -> 40
 * Large (L - 42") -> 42
 * X-Large (XL - 44") -> 44
 * XX-Large (XXL - 46") -> 46
 * 3X-Large (3XL - 48") -> 48
 * Plus additional sizes: 50, 52.
 */
export const JERSEY_SIZE_MAP: Record<string, NumericJerseySize> = {
  S: '38',
  M: '40',
  L: '42',
  XL: '44',
  XXL: '46',
  '3XL': '48',
  '38': '38',
  '40': '40',
  '42': '42',
  '44': '44',
  '46': '46',
  '48': '48',
  '50': '50',
  '52': '52',
};

export const JERSEY_SIZE_OPTIONS: Array<{ value: NumericJerseySize; label: string }> = [
  { value: '38', label: '38' },
  { value: '40', label: '40' },
  { value: '42', label: '42' },
  { value: '44', label: '44' },
  { value: '46', label: '46' },
  { value: '48', label: '48' },
  { value: '50', label: '50' },
  { value: '52', label: '52' },
];

/**
 * Converts any legacy letter size (S, M, L, XL, XXL, 3XL) or numeric size
 * into the standardized numeric jersey size string (38, 40, 42, 44, 46, 48, 50, 52).
 * Defaults to '40' if empty or unmapped.
 */
export function toNumericJerseySize(val: string | null | undefined): NumericJerseySize {
  if (!val) return '40';
  const trimmed = String(val).trim().toUpperCase();
  return (
    JERSEY_SIZE_MAP[trimmed] ||
    (NUMERIC_JERSEY_SIZES.includes(trimmed as NumericJerseySize)
      ? (trimmed as NumericJerseySize)
      : '40')
  );
}
