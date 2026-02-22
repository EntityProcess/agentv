/**
 * Evaluator registry — extensible evaluator type dispatch.
 *
 * @module
 */
export { EvaluatorRegistry, DeterministicAssertionEvaluator } from './evaluator-registry.js';
export type { EvaluatorDispatchContext, EvaluatorFactoryFn } from './evaluator-registry.js';
export { createBuiltinRegistry } from './builtin-evaluators.js';
