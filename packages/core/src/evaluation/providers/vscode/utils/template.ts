export function renderTemplate(content: string, variables: Record<string, string>): string {
  if (!content) {
    return content;
  }

  const variableLookup = new Map<string, string>();
  for (const [key, value] of Object.entries(variables)) {
    variableLookup.set(key.toLowerCase(), value);
  }

  const referencedVariables = new Set<string>();

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
