#!/usr/bin/env bun
/**
 * Code grader: verifies file_changes captures BOTH workspace-root files
 * and changes inside nested git repos.
 *
 * Expected diff should include:
 *   - report.txt        (new file at workspace root)
 *   - my-lib/utils.ts  (modification inside the nested repo)
 */
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as {
  file_changes: string | null;
};

const fileChanges = input.file_changes ?? '';
const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

if (!fileChanges || fileChanges.trim().length === 0) {
  assertions.push({
    text: 'file_changes is non-empty',
    passed: false,
    evidence: 'file_changes is empty — workspace not configured or file tracking failed',
  });
  console.log(JSON.stringify({ score: 0, assertions }));
  process.exit(0);
}

assertions.push({ text: 'file_changes is non-empty', passed: true });

// Check 1: workspace-root file appears in diff
const hasRootFile = fileChanges.includes('report.txt');
assertions.push({
  text: 'diff captures workspace-root file (report.txt)',
  passed: hasRootFile,
  evidence: hasRootFile
    ? undefined
    : `file_changes did not mention report.txt.\nDiff:\n${fileChanges.slice(0, 500)}`,
});

// Check 2: nested repo change appears in diff
const hasRepoChange = fileChanges.includes('my-lib/utils.ts') || fileChanges.includes('utils.ts');
assertions.push({
  text: 'diff captures nested-repo change (my-lib/utils.ts)',
  passed: hasRepoChange,
  evidence: hasRepoChange
    ? undefined
    : `file_changes did not mention utils.ts.\nDiff:\n${fileChanges.slice(0, 500)}`,
});

// Check 3: diff shows the add function was added
const hasAddFn = fileChanges.includes('+export function add');
assertions.push({
  text: 'diff shows add() function was added',
  passed: hasAddFn,
  evidence: hasAddFn ? undefined : 'add() function not found in diff',
});

const passed = assertions.filter((a) => a.passed).length;
console.log(JSON.stringify({ score: passed / assertions.length, assertions }));
