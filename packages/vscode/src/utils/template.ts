/**
 * Renders a template string by replacing {{variableName}} placeholders with corresponding values.
 *
 * @param content - The template string containing {{variableName}} placeholders
 * @param variables - An object mapping variable names to their replacement values
 * @returns The rendered string with all placeholders replaced
 * @throws Error if a variable is referenced in the template but not provided in the variables object
 *
 * @example
 * ```typescript
 * const template = "Hello {{userName}}, your file is at {{filePath}}";
 * const result = renderTemplate(template, { userName: "Alice", filePath: "/tmp/file.txt" });
 * // result: "Hello Alice, your file is at /tmp/file.txt"
 * ```
 */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  // Handle empty templates
  if (!content) {
    return content;
  }

  // Create a case-insensitive lookup map for variables
  const variableLookup = new Map<string, string>();
  for (const [key, value] of Object.entries(variables)) {
    variableLookup.set(key.toLowerCase(), value);
  }

  // Track which variables were found in the template
  const referencedVariables = new Set<string>();

  // Replace all {{variableName}} placeholders
  const result = content.replace(/\{\{([a-zA-Z_]+)\}\}/gi, (match, variableName: string) => {
    const lowerCaseKey = variableName.toLowerCase();
    referencedVariables.add(lowerCaseKey);

    if (!variableLookup.has(lowerCaseKey)) {
      throw new Error(
        `Template variable '${variableName}' is not provided in the variables object`,
      );
    }

    return variableLookup.get(lowerCaseKey) as string;
  });

  return result;
}
