/**
 * Case conversion utilities for JSON payloads.
 * Converts between snake_case (wire format) and camelCase (TypeScript).
 */

function toCamelCase(str: string): string {
  // Don't convert keys that start with uppercase (proper nouns/tool names)
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively converts all keys in an object from snake_case to camelCase.
 * Used to map wire payloads into TypeScript-friendly shapes.
 *
 * @param obj - The object to convert (can be any JSON-serializable value)
 * @returns A new object with all keys converted to camelCase
 */
export function toCamelCaseDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toCamelCaseDeep(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = toCamelCase(key);
      result[camelKey] = toCamelCaseDeep(value);
    }
    return result;
  }

  return obj;
}
