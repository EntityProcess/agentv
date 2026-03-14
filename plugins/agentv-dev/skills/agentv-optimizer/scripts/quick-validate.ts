#!/usr/bin/env bun
/**
 * quick-validate.ts
 * 
 * Validates bundle structure with wrapper-stage mode for early checks
 * and full-bundle mode for final verification.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { resolveSkillRoot } from "../src/paths.js";

interface ValidationError {
  path: string;
  message: string;
}

function validateWrapperStage(): ValidationError[] {
  const errors: ValidationError[] = [];
  const skillRoot = resolveSkillRoot();

  // Check for core wrapper files
  const wrapperFiles = [
    "src/command-runner.ts",
    "src/artifact-readers.ts",
    "src/paths.ts",
  ];

  for (const file of wrapperFiles) {
    const fullPath = resolve(skillRoot, file);
    if (!existsSync(fullPath)) {
      errors.push({ path: file, message: "Wrapper file missing" });
    }
  }

  // Check for fixture files
  const fixtureFiles = [
    "src/__fixtures__/benchmark.json",
    "src/__fixtures__/grading.json",
    "src/__fixtures__/timing.json",
    "src/__fixtures__/results.jsonl",
  ];

  for (const file of fixtureFiles) {
    const fullPath = resolve(skillRoot, file);
    if (!existsSync(fullPath)) {
      errors.push({ path: file, message: "Fixture file missing" });
    }
  }

  return errors;
}

function validateFullBundle(): ValidationError[] {
  const errors: ValidationError[] = [];
  const skillRoot = resolveSkillRoot();

  // First check wrapper stage
  errors.push(...validateWrapperStage());

  // Check for script files
  const scriptFiles = [
    "scripts/quick-validate.ts",
    "scripts/run-eval.ts",
    "scripts/prompt-eval.ts",
    "scripts/convert-evals.ts",
    "scripts/compare-runs.ts",
  ];

  for (const file of scriptFiles) {
    const fullPath = resolve(skillRoot, file);
    if (!existsSync(fullPath)) {
      errors.push({ path: file, message: "Script file missing" });
    }
  }

  // Check for test files
  const testFiles = [
    "src/__tests__/command-runner.test.ts",
    "src/__tests__/artifact-readers.test.ts",
  ];

  for (const file of testFiles) {
    const fullPath = resolve(skillRoot, file);
    if (!existsSync(fullPath)) {
      errors.push({ path: file, message: "Test file missing" });
    }
  }

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const scope = args.includes("--scope") 
    ? args[args.indexOf("--scope") + 1] 
    : "full";

  const errors = scope === "wrappers" 
    ? validateWrapperStage() 
    : validateFullBundle();

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`  ✗ ${error.path}: ${error.message}`);
    }
    process.exit(1);
  }

  console.log(`✓ Validation passed (scope: ${scope})`);
  process.exit(0);
}

main();
