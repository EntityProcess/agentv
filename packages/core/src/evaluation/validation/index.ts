/**
 * Validation module for AgentV eval and targets files.
 */

export { detectFileType, isValidSchema, getExpectedSchema } from './file-type.js';
export { isTypeScriptEvalConfigFileName } from '../loaders/ts-eval-loader.js';
export { validateEvalFile, validateTypeScriptEvalConfigFile } from './eval-validator.js';
export { validateCasesFile } from './cases-validator.js';
export { validateTargetsFile } from './targets-validator.js';
export { validateConfigFile } from './config-validator.js';
export { validateFileReferences } from './file-reference-validator.js';
export { validateWorkspacePaths } from './workspace-path-validator.js';
export type {
  FileType,
  ValidationSeverity,
  ValidationError,
  ValidationResult,
  ValidationSummary,
} from './types.js';
