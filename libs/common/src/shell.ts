import { exec } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);

const SAFE_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

export function assertSafeName(value: string, label = 'value'): string {
  if (!SAFE_NAME_REGEX.test(value)) {
    throw new Error(
      `Invalid ${label}: "${value}". Only letters, digits, underscores and hyphens are allowed.`,
    );
  }
  return value;
}
