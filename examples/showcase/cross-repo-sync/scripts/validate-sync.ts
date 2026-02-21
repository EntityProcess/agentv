/**
 * Code judge for cross-repo sync validation.
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

import { defineCodeJudge } from '@agentv/eval';

defineCodeJudge(({ fileChanges, config }) => {
  const hits: string[] = [];
  const misses: string[] = [];

  // Config keys are camelCased by the SDK runtime (expected_files_modified → expectedFilesModified)
  const expectedFiles: string[] =
    (config?.expectedFilesModified as string[]) ??
    (config?.expected_files_modified as string[]) ??
    [];
  const expectedKeywords: string[] =
    (config?.expectedKeywords as string[]) ?? (config?.expected_keywords as string[]) ?? [];

  if (!fileChanges) {
    misses.push('No file changes captured');
    return {
      score: 0,
      hits,
      misses,
      reasoning: 'Agent produced no file changes',
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
      hits.push(`file modified: ${expectedPath}`);
    } else {
      misses.push(`file NOT modified: ${expectedPath}`);
    }
  }

  // Check keyword presence in the diff content
  const diffLower = fileChanges.toLowerCase();
  for (const keyword of expectedKeywords) {
    if (diffLower.includes(keyword.toLowerCase())) {
      hits.push(`keyword found: ${keyword}`);
    } else {
      misses.push(`keyword NOT found: ${keyword}`);
    }
  }

  const total = hits.length + misses.length;
  const score = total > 0 ? hits.length / total : 0;

  return {
    score,
    hits,
    misses,
    reasoning: `${hits.length}/${total} checks passed`,
    details: {
      files_checked: expectedFiles.length,
      keywords_checked: expectedKeywords.length,
    },
  };
});
