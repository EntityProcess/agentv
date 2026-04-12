#!/usr/bin/env bun
/**
 * Code grader: checks that file_changes contains outputs/report.csv
 * with a header row and at least one data row.
 *
 * This grader is intentionally self-contained — no LLM required.
 * It proves the workspace-snapshot feature is working by inspecting
 * the file_changes diff captured from the temp workspace.
 */
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8')) as {
  file_changes: string | null;
  criteria: string | null;
};

const fileChanges: string = input.file_changes ?? '';

const assertions: Array<{ text: string; passed: boolean; evidence?: string }> = [];

// Check 1: file_changes is non-empty
if (!fileChanges || fileChanges.trim().length === 0) {
  assertions.push({
    text: 'file_changes is non-empty',
    passed: false,
    evidence: 'file_changes is empty — workspace snapshot or git baseline may not be configured',
  });
  console.log(JSON.stringify({ score: 0, assertions }));
  process.exit(0);
}

assertions.push({ text: 'file_changes is non-empty', passed: true });

// Check 2: diff mentions outputs/report.csv
const hasCsvFile = fileChanges.includes('outputs/report.csv');
assertions.push({
  text: 'diff contains outputs/report.csv',
  passed: hasCsvFile,
  evidence: hasCsvFile
    ? undefined
    : `file_changes did not mention outputs/report.csv. Got:\n${fileChanges.slice(0, 500)}`,
});

// Extract CSV lines from the diff (lines starting with '+' that are not '+++')
const csvLines = fileChanges
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  .map((line) => line.slice(1)); // strip leading '+'

// Check 3: has header row (non-empty first content line)
const headerLine = csvLines[0] ?? '';
const hasHeader = headerLine.includes(',');
assertions.push({
  text: 'CSV has a header row',
  passed: hasHeader,
  evidence: hasHeader ? undefined : `First CSV line: "${headerLine}"`,
});

// Check 4: has at least one data row
const dataRows = csvLines.slice(1).filter((l) => l.trim().length > 0 && l.includes(','));
const hasDataRow = dataRows.length > 0;
assertions.push({
  text: 'CSV has at least one data row',
  passed: hasDataRow,
  evidence: hasDataRow ? undefined : 'No data rows found after the header',
});

const passed = assertions.filter((a) => a.passed).length;
const score = passed / assertions.length;

console.log(JSON.stringify({ score, assertions }));
