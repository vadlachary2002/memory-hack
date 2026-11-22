// One-line trace per decision, printed only when TRACE is set. Judges can watch every step.

const ENABLED = (process.env.TRACE ?? '') !== '';

export function trace(step: string, detail: Record<string, unknown> = {}): void {
  if (!ENABLED) return;
  const parts = Object.entries(detail).map(([key, value]) => `${key}=${format(value)}`);
  console.error(`[trace] ${step}${parts.length === 0 ? '' : ' '}${parts.join(' ')}`);
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '-' : value.join(',');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value;
  return String(value);
}
