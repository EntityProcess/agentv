import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type ValidationResult,
  type ValidationSummary,
  detectFileType,
  validateConfigFile,
  validateEvalFile,
  validateFileReferences,
  validateTargetsFile,
} from '@agentv/core/evaluation/validation';
import fg from 'fast-glob';

/**
 * Validate YAML files for AgentV schema compliance.
 */
export async function validateFiles(paths: readonly string[]): Promise<ValidationSummary> {
  const filePaths = await expandPaths(paths);
  const results: ValidationResult[] = [];

  for (const filePath of filePaths) {
    const result = await validateSingleFile(filePath);
    results.push(result);
  }

  const validFiles = results.filter((r) => r.valid).length;
  const invalidFiles = results.filter((r) => !r.valid).length;

  return {
    totalFiles: results.length,
    validFiles,
    invalidFiles,
    results,
  };
}

async function validateSingleFile(filePath: string): Promise<ValidationResult> {
  const absolutePath = path.resolve(filePath);

  // Detect file type (now infers from path if $schema is missing)
  const fileType = await detectFileType(absolutePath);

  // Validate based on file type
  let result: ValidationResult;

  if (fileType === 'eval') {
    result = await validateEvalFile(absolutePath);

    // Also validate file references for eval files
    if (result.valid || result.errors.filter((e) => e.severity === 'error').length === 0) {
      const fileRefErrors = await validateFileReferences(absolutePath);
      if (fileRefErrors.length > 0) {
        result = {
          ...result,
          errors: [...result.errors, ...fileRefErrors],
          valid: result.valid && fileRefErrors.filter((e) => e.severity === 'error').length === 0,
        };
      }
    }
  } else if (fileType === 'targets') {
    result = await validateTargetsFile(absolutePath);
  } else {
    result = await validateConfigFile(absolutePath);
  }

  return result;
}

async function expandPaths(paths: readonly string[]): Promise<readonly string[]> {
  const expanded = new Set<string>();

  for (const inputPath of paths) {
    const absolutePath = path.resolve(inputPath);

    // Try as literal file or directory first
    try {
      await access(absolutePath, constants.F_OK);
      const stats = await stat(absolutePath);

      if (stats.isFile()) {
        if (isYamlFile(absolutePath)) expanded.add(absolutePath);
        continue;
      }
      if (stats.isDirectory()) {
        const yamlFiles = await findYamlFiles(absolutePath);
        for (const f of yamlFiles) expanded.add(f);
        continue;
      }
    } catch {
      // Not a literal path — fall through to glob matching
    }

    // Treat as glob pattern
    const globPattern = inputPath.includes('\\') ? inputPath.replace(/\\/g, '/') : inputPath;
    const matches = await fg(globPattern, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: true,
    });

    const yamlMatches = matches.filter((f) => isYamlFile(f));
    if (yamlMatches.length === 0) {
      console.warn(`Warning: No YAML files matched pattern: ${inputPath}`);
    }
    for (const f of yamlMatches) expanded.add(path.normalize(f));
  }

  const sorted = Array.from(expanded);
  sorted.sort();
  return sorted;
}

async function findYamlFiles(dirPath: string): Promise<readonly string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        const subFiles = await findYamlFiles(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile() && isYamlFile(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dirPath}: ${(error as Error).message}`);
  }

  return results;
}

function isYamlFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.yaml' || ext === '.yml';
}
