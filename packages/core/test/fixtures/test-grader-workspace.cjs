#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const checks = [];

// Check workspace_path in JSON payload
if (typeof input.workspace_path === 'string' && input.workspace_path.length > 0) {
  checks.push({
    text: 'workspace_path present in payload',
    pass: true,
    reason: 'workspace_path is present',
  });
} else {
  checks.push({
    text: 'workspace_path present in payload',
    pass: false,
    reason: 'workspace_path is missing',
  });
}

// Check AGENTV_WORKSPACE_PATH env var
const envPath = process.env.AGENTV_WORKSPACE_PATH;
if (typeof envPath === 'string' && envPath.length > 0) {
  checks.push({
    text: 'AGENTV_WORKSPACE_PATH env var set',
    pass: true,
    reason: 'AGENTV_WORKSPACE_PATH is set',
  });
} else {
  checks.push({
    text: 'AGENTV_WORKSPACE_PATH env var set',
    pass: false,
    reason: 'AGENTV_WORKSPACE_PATH is missing',
  });
}

// Check that both match when present
if (input.workspace_path && envPath && input.workspace_path === envPath) {
  checks.push({
    text: 'payload and env var match',
    pass: true,
    reason: 'Both workspace paths match',
  });
} else if (input.workspace_path && envPath) {
  checks.push({
    text: 'payload and env var match',
    pass: false,
    reason: 'Workspace paths do not match',
  });
}

const passed = checks.filter((check) => check.pass).length;
const pass = checks.length > 0 && passed === checks.length;
const score = pass ? 1.0 : passed / checks.length;

console.log(
  JSON.stringify({ pass, score, reason: `${passed}/${checks.length} checks passed`, checks }),
);
