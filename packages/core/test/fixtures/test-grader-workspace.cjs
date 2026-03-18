#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const assertions = [];

// Check workspace_path in JSON payload
if (typeof input.workspace_path === 'string' && input.workspace_path.length > 0) {
  assertions.push({ text: 'workspace_path present in payload', passed: true });
} else {
  assertions.push({ text: 'workspace_path missing from payload', passed: false });
}

// Check AGENTV_WORKSPACE_PATH env var
const envPath = process.env.AGENTV_WORKSPACE_PATH;
if (typeof envPath === 'string' && envPath.length > 0) {
  assertions.push({ text: 'AGENTV_WORKSPACE_PATH env var set', passed: true });
} else {
  assertions.push({ text: 'AGENTV_WORKSPACE_PATH env var missing', passed: false });
}

// Check that both match when present
if (input.workspace_path && envPath && input.workspace_path === envPath) {
  assertions.push({ text: 'payload and env var match', passed: true });
} else if (input.workspace_path && envPath) {
  assertions.push({ text: 'payload and env var do not match', passed: false });
}

const passed = assertions.filter((a) => a.passed).length;
const score = assertions.every((a) => a.passed) ? 1.0 : passed / assertions.length;

console.log(JSON.stringify({ score, assertions }));
