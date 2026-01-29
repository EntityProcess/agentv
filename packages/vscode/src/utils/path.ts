import path from 'node:path';

/**
 * Converts a file path to a file:// URI.
 *
 * @param filePath - The file path to convert (can be relative or absolute)
 * @returns A properly formatted file:// URI
 *
 * @example
 * ```typescript
 * // Windows
 * pathToFileUri("C:\\Users\\file.txt") // "file:///C:/Users/file.txt"
 *
 * // Unix
 * pathToFileUri("/home/user/file.txt") // "file:///home/user/file.txt"
 * ```
 */
export function pathToFileUri(filePath: string): string {
  // Convert to absolute path if relative
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  // On Windows, convert backslashes to forward slashes
  const normalizedPath = absolutePath.replace(/\\/g, '/');

  // Handle Windows drive letters (e.g., C:/ becomes file:///C:/)
  if (/^[a-zA-Z]:\//.test(normalizedPath)) {
    return `file:///${normalizedPath}`;
  }

  // Unix-like paths
  return `file://${normalizedPath}`;
}
