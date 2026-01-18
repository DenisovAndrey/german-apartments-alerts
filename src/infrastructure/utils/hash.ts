import crypto from 'crypto';

export function buildHash(...inputs: (string | number | null | undefined)[]): string {
  const cleaned = inputs
    .filter((i): i is string | number => i != null && String(i).length > 0)
    .map(String);

  if (cleaned.length === 0) {
    return crypto.createHash('sha256').update(Date.now().toString()).digest('hex');
  }

  return crypto.createHash('sha256').update(cleaned.join(',')).digest('hex');
}
