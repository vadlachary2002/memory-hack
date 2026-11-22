// Account-number shapes are never persisted anywhere: not as facts, not in the raw transcript.

// "ACC-7781", "HDFC00012345", 8+ digit runs, IBAN-like strings.
export const ACCOUNT_NUMBER = /\b[A-Z]{2,5}-?\d{4,}\b|\b\d{8,}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/g;

const REMOVED = '[account removed]';

export function hasAccountNumber(text: string): boolean {
  return new RegExp(ACCOUNT_NUMBER.source).test(text);
}

export function scrubAccountNumbers(text: string): string {
  return text.replace(new RegExp(ACCOUNT_NUMBER.source, 'g'), REMOVED);
}
