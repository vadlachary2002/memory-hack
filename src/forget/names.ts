// Whole-word, case-insensitive name matching shared by strip, redact and the audit scan.
// Word boundaries matter: alias "Pri" must not hit "price".

const REDACTED = '[redacted]';

export function containsName(text: string | null | undefined, needles: readonly string[]): boolean {
  if (!text) return false;
  return needles.some((needle) => pattern(needle).test(text));
}

export function redactNames(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) out = out.replace(pattern(needle), `$1${REDACTED}`);
  return out;
}

// Trimmed, de-duplicated, non-empty needles.
export function cleanNeedles(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen];
}

function pattern(needle: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=[^\\p{L}\\p{N}]|$)`, 'giu');
}
