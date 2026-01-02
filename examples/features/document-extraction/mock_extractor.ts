#!/usr/bin/env bun
/**
 * Mock Invoice Extractor
 * 
 * Simulates an invoice extraction system that reads structured data from JSON fixtures.
 * In a real implementation, this would parse PDFs/images using OCR or vision models.
 * 
 * This mock simply reads pre-extracted JSON data to demonstrate the field_accuracy evaluator.
 * 
 * Usage: bun run mock_extractor.ts <input-file> [output-file]
 */

import { readFileSync, writeFileSync } from "node:fs";

// Main execution
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run mock_extractor.ts <input-file> [output-file]");
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1];
const data = readFileSync(inputFile, "utf-8");

// Output as JSON for AgentV to consume
if (outputFile) {
  writeFileSync(outputFile, data, "utf-8");
} else {
  console.log(data);
}
