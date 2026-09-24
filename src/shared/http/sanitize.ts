import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Removes all markup (script/style contents included); text is entity-encoded for safe HTML rendering. */
export function stripHtml(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}

export const safeText = (maxLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((v) => !CONTROL_CHARS.test(v), 'must not contain control characters')
    .transform(stripHtml)
    .refine((v) => v.length > 0, 'must contain text after removing markup');
