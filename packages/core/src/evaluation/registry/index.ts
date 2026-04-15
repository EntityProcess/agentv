/**
 * Grader registry — extensible grader type dispatch.
 *
 * @module
 */
export { GraderRegistry, DeterministicAssertionGrader } from './grader-registry.js';
export type { GraderDispatchContext, GraderFactoryFn } from './grader-registry.js';
export { createBuiltinRegistry } from './builtin-graders.js';
export { discoverAssertions } from './assertion-discovery.js';
export { discoverGraders } from './grader-discovery.js';
