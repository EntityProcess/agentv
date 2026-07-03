import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = path.join(webRoot, 'dist');
const v4Routes = JSON.parse(
  readFileSync(path.join(webRoot, 'src/data/docs-v4.42.4-routes.json'), 'utf8'),
);

const checks = [
  {
    path: 'docs/index.html',
    includes: ['Introduction | AgentV', ' Current '],
    excludes: ['Redirecting to:'],
  },
  {
    path: 'docs/targets/llm-providers/index.html',
    includes: ['LLM Providers | AgentV', '<h1 id="_top"'],
    excludes: ['Redirecting to:'],
  },
  {
    path: 'docs/v4.42.4/targets/llm-providers/index.html',
    includes: ['LLM Providers | AgentV', '/docs/v4.42.4/targets/llm-providers/'],
    excludes: ['Redirecting to:', '/docs/v4424/'],
  },
  {
    path: 'docs/next/targets/llm-providers/index.html',
    includes: ['Redirecting to: /docs/targets/llm-providers/'],
  },
];

for (const check of checks) {
  const file = path.join(distRoot, check.path);
  if (!existsSync(file)) {
    fail(`Missing built docs route: ${check.path}`);
  }

  const html = readFileSync(file, 'utf8');
  for (const expected of check.includes ?? []) {
    if (!html.includes(expected)) {
      fail(`${check.path} does not include expected content: ${expected}`);
    }
  }

  for (const unexpected of check.excludes ?? []) {
    if (html.includes(unexpected)) {
      fail(`${check.path} includes unexpected content: ${unexpected}`);
    }
  }
}

if (existsSync(path.join(distRoot, 'docs/v4424'))) {
  fail('Unexpected normalized archive route directory emitted: docs/v4424');
}

for (const route of v4Routes) {
  const routeFile = path.join(distRoot, route, 'index.html');
  if (!existsSync(routeFile)) {
    fail(`Missing archived manifest route: ${route}`);
  }
}

console.log('Docs route checks passed');

function fail(message) {
  console.error(message);
  process.exit(1);
}
