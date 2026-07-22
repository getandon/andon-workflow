import { ObjectId } from 'mongodb';

export function toHex(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.toHexString) return v.toHexString();
  return String(v);
}

export function isValidHex(v: any): boolean {
  const hex = toHex(v);
  return hex.length === 24;
}

export function toObjectId(v: any): ObjectId | null {
  if (v instanceof ObjectId) return v;
  if (!isValidHex(v)) return null;
  try {
    return new ObjectId(toHex(v));
  } catch {
    return null;
  }
}
