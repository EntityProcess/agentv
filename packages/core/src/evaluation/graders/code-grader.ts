// Compatibility re-export for older imports. New internal code uses script-grader.ts.
export {
  ScriptGrader,
  ScriptGrader as CodeGrader,
  executeScript,
  materializeContentForGrader,
} from './script-grader.js';
export type {
  ScriptGraderOptions,
  ScriptGraderOptions as CodeGraderOptions,
} from './script-grader.js';
