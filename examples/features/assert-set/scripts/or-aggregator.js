const fs = require('node:fs');

function getScore(result) {
  if (result === null || typeof result !== 'object') {
    return 0;
  }

  if (result.verdict === 'pass') {
    return 1;
  }

  if (typeof result.verdict === 'string' && result.verdict === 'skip') {
    return 0;
  }

  if (typeof result.score === 'number') {
    return result.score >= 0.5 ? 1 : 0;
  }

  return 0;
}

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const results = Object.values(input.results ?? {});
  const anyPassed = results.some(getScore);

  console.log(
    JSON.stringify({
      score: anyPassed ? 1 : 0,
      verdict: anyPassed ? 'pass' : 'fail',
      assertions: [
        {
          text: `Strict OR passed if any child passed: ${anyPassed ? 'true' : 'false'}`,
          passed: anyPassed,
        },
      ],
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      score: 0,
      verdict: 'fail',
      assertions: [
        {
          text: `Failed to evaluate strict OR: ${error instanceof Error ? error.message : String(error)}`,
          passed: false,
        },
      ],
    }),
  );
}
