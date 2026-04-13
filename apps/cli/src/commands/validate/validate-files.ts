import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  type ValidationResult,
  type ValidationSummary,
  detectFileType,
  validateCasesFile,
  validateConfigFile,
  validateEvalFile,
  validateFileReferences,
  validateTargetsFile,
  validateWorkspacePaths,
} from '@agentv/core/evaluation/validation';
import fg from 'fast-glob';

/**
 * Validate YAML files for AgentV schema compliance.
 */
export async function validateFiles(paths: readonly string[]): Promise<ValidationSummary> {
  const filePaths = await expandPaths(paths);
  const results = await Promise.all(filePaths.map((filePath) => validateSingleFile(filePath)));

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

    // Also validate file references and workspace paths for eval files
    if (result.valid || result.errors.filter((e) => e.severity === 'error').length === 0) {
      const [fileRefErrors, workspaceErrors] = await Promise.all([
        validateFileReferences(absolutePath),
        validateWorkspacePaths(absolutePath),
      ]);
      const extraErrors = [...fileRefErrors, ...workspaceErrors];
      if (extraErrors.length > 0) {
        result = {
          ...result,
          errors: [...result.errors, ...extraErrors],
          valid: result.valid && extraErrors.filter((e) => e.severity === 'error').length === 0,
        };
      }
    }
  } else if (fileType === 'cases') {
    result = await validateCasesFile(absolutePath);
  } else if (fileType === 'targets') {
    result = await validateTargetsFile(absolutePath);
  } else if (fileType === 'config') {
    result = await validateConfigFile(absolutePath);
  } else {
    // Unknown file type — skip validation, report as skipped
    result = {
      valid: true,
      filePath: absolutePath,
      fileType: 'unknown',
      errors: [
        {
          severity: 'warning',
          filePath: absolutePath,
          message:
            'File type not recognized. Eval files must end in .eval.yaml. Skipping validation.',
        },
      ],
    };
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
      } else if (entry.isFile() && isEvalYamlFile(entry.name)) {
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

/** Returns true only for *.eval.yaml / *.eval.yml files (used for directory scanning). */
function isEvalYamlFile(filePath: string): boolean {
  const lower = path.basename(filePath).toLowerCase();
  return lower.endsWith('.eval.yaml') || lower.endsWith('.eval.yml');
}
