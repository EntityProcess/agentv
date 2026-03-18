/**
 * Code grader for cross-repo sync validation.
 *
 * Compares the agent's fileChanges against the ground truth diff:
 * - File-level overlap: which expected files were modified
 * - Keyword matching: key terms that should appear in modifications
 *
 * Pass-through config (from assert block in YAML):
 *   - expected_files_modified: string[] — paths that should appear in fileChanges
 *   - expected_keywords: string[] — terms that should appear in the diff
 *   - ground_truth: string — path to the ground truth diff file (from metadata)
 */

import { defineCodeGrader } from '@agentv/eval';

defineCodeGrader(({ fileChanges, config }) => {
  const assertions: Array<{ text: string; passed: boolean }> = [];

  // Config keys are camelCased by the SDK runtime (expected_files_modified → expectedFilesModified)
  const expectedFiles: string[] =
    (config?.expectedFilesModified as string[]) ??
    (config?.expected_files_modified as string[]) ??
    [];
  const expectedKeywords: string[] =
    (config?.expectedKeywords as string[]) ?? (config?.expected_keywords as string[]) ?? [];

  if (!fileChanges) {
    assertions.push({ text: 'No file changes captured', passed: false });
    return {
      score: 0,
      assertions,
    };
  }

  // Parse diff blocks
  const diffBlocks = fileChanges.split(/(?=^diff --git )/m);

  // Check file-level overlap
  for (const expectedPath of expectedFiles) {
    const found = diffBlocks.some(
      (block) => block.includes(`a/${expectedPath}`) || block.includes(`b/${expectedPath}`),
    );
    if (found) {
      assertions.push({ text: `file modified: ${expectedPath}`, passed: true });
    } else {
      assertions.push({ text: `file NOT modified: ${expectedPath}`, passed: false });
    }
  }

  // Check keyword presence in the diff content
  const diffLower = fileChanges.toLowerCase();
  for (const keyword of expectedKeywords) {
    if (diffLower.includes(keyword.toLowerCase())) {
      assertions.push({ text: `keyword found: ${keyword}`, passed: true });
    } else {
      assertions.push({ text: `keyword NOT found: ${keyword}`, passed: false });
    }
  }

  const passed = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  const score = total > 0 ? passed / total : 0;

  return {
    score,
    assertions,
    details: {
      files_checked: expectedFiles.length,
      keywords_checked: expectedKeywords.length,
    },
  };
});
