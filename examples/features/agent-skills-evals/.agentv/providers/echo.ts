/**
 * Echo provider — returns the input prompt as the agent response.
 *
 * Used for testing skill-trigger assertions without a real agent.
 * The evaluator checks whether the prompt would have triggered a skill,
 * not whether the response is correct.
 *
 * Convention-based provider: referenced as `provider: echo` in targets.yaml.
 */
const input = process.argv[2] ?? '';
console.log(input);
