import { z } from 'zod';

// A non-empty string that keeps its original value (no trimming), matching the
// hand-written `requireString` checks this replaces.
export function nonEmptyString(message = 'must be a non-empty string') {
  return z
    .string({ error: message })
    .refine((value) => value.trim().length > 0, { error: message });
}

// Validates `value` against `schema` and returns the parsed (and possibly
// transformed) result, throwing a single readable error on the first violation.
// The message is `<path> <message>`, e.g. `fontstacks[0].font must be a non-empty
// string`, so callers get the same field-scoped errors the manual validators gave.
export function parse<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = formatPath(issue.path);
    throw new TypeError(path ? `${path} ${issue.message}` : issue.message);
  }

  return result.data;
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let formatted = '';

  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted ? `.${String(segment)}` : String(segment);
    }
  }

  return formatted;
}
