#!/usr/bin/env node
const fs = require('node:fs');

const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const hits = [];
const misses = [];

// Check workspace_path in JSON payload
if (typeof input.workspace_path === 'string' && input.workspace_path.length > 0) {
  hits.push('workspace_path present in payload');
} else {
  misses.push('workspace_path missing from payload');
}

// Check AGENTV_WORKSPACE_PATH env var
const envPath = process.env.AGENTV_WORKSPACE_PATH;
if (typeof envPath === 'string' && envPath.length > 0) {
  hits.push('AGENTV_WORKSPACE_PATH env var set');
} else {
  misses.push('AGENTV_WORKSPACE_PATH env var missing');
}

// Check that both match when present
if (input.workspace_path && envPath && input.workspace_path === envPath) {
  hits.push('payload and env var match');
} else if (input.workspace_path && envPath) {
  misses.push('payload and env var do not match');
}

const score = misses.length === 0 ? 1.0 : hits.length / (hits.length + misses.length);

console.log(JSON.stringify({ score, hits, misses }));
