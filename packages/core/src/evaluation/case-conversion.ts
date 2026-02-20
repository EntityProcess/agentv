/**
 * Converts a camelCase string to snake_case.
 * Examples:
 *   testId -> test_id
 *   candidateAnswer -> candidate_answer
 *   conversationId -> conversation_id
 *
 * Note: Keys that start with an uppercase letter are treated as proper nouns
 * and returned unchanged (e.g., "Read", "Edit" for tool names).
 */
function toSnakeCase(str: string): string {
  // Don't convert keys that start with uppercase (proper nouns/tool names)
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(str: string): string {
  if (/^[A-Z]/.test(str)) {
    return str;
  }
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively converts all keys in an object from camelCase to snake_case.
 * This is used to convert TypeScript internal representations to snake_case
 * for Python ecosystem compatibility in JSON payloads.
 *
 * Conversion rules:
 * - Object keys: camelCase -> snake_case
 * - Array elements: recursively converted
 * - Primitives: returned unchanged
 * - null/undefined: returned unchanged
 *
 * @param obj - The object to convert (can be any JSON-serializable value)
 * @returns A new object with all keys converted to snake_case
 */
export function toSnakeCaseDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => toSnakeCaseDeep(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = toSnakeCase(key);
      result[snakeKey] = toSnakeCaseDeep(value);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively converts all keys in an object from snake_case to camelCase.
 * This is used by optional SDK helpers to map wire payloads into TypeScript-friendly
 * shapes.
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
