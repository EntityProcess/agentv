import assert from 'node:assert/strict';

// Tests run against compiled output
const { add, multiply, fibonacci } = await import('../dist/index.js');

// add tests
assert.strictEqual(add(2, 3), 5, 'add(2, 3) should be 5');
assert.strictEqual(add(-1, -2), -3, 'add(-1, -2) should be -3');
assert.strictEqual(add(0, 5), 5, 'add(0, 5) should be 5');

// multiply tests
assert.strictEqual(multiply(3, 4), 12, 'multiply(3, 4) should be 12');
assert.strictEqual(multiply(5, 0), 0, 'multiply(5, 0) should be 0');
assert.strictEqual(multiply(-2, 3), -6, 'multiply(-2, 3) should be -6');

// fibonacci tests
assert.strictEqual(fibonacci(0), 0, 'fibonacci(0) should be 0');
assert.strictEqual(fibonacci(1), 1, 'fibonacci(1) should be 1');
assert.strictEqual(fibonacci(6), 8, 'fibonacci(6) should be 8');
assert.strictEqual(fibonacci(10), 55, 'fibonacci(10) should be 55');

console.log('All tests passed');
