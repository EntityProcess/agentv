# Eval File Review Checklist

## Naming

- [ ] File uses `.eval.yaml` extension
- [ ] Filename matches the skill or workflow being tested
- [ ] Consistent naming prefix across the plugin's eval files (e.g., all files share a common prefix)

## Top-Level Structure

- [ ] `description` field present and descriptive
- [ ] `execution` block present if required by repo convention (optional in AgentV)
- [ ] Top-level `input` used for shared file references instead of repeating in every test

## Per-Test Structure

- [ ] Each test has a unique `id`
- [ ] Each test has `criteria` describing success
- [ ] Each test has `input` (string or Message array)
- [ ] File paths in `type: file` values use leading `/` (absolute from repo root)

## Assertions

- [ ] `assertions` blocks present (not relying solely on `expected_output` prose)
- [ ] Deterministic assertions used where possible (`contains`, `regex`, `is-json`)
- [ ] `llm-grader` only used when semantic understanding is required
- [ ] `expected_output` contains representative sample output, not evaluation criteria prose
- [ ] `expected_output` and `criteria` are not redundant — remove one if they say the same thing

## Factual Accuracy

- [ ] Commands referenced in test inputs (e.g., `/pr-verify 1234`) actually exist as defined commands
- [ ] Tool/command names match what the skill documents (e.g., skill says `pytest` but eval says `python -m unittest`)
- [ ] Output filenames referenced in expected_output match what the skill produces
- [ ] Skill paths in `type: file` values point to files that exist

## Coverage

- [ ] Every SKILL.md in the PR has a corresponding eval file
- [ ] Happy path tested
- [ ] Edge cases tested (empty input, missing prerequisites, no-op scenarios)
- [ ] Error paths tested (invalid input, missing dependencies)
- [ ] For multi-skill workflows: at least one eval tests the full pipeline, not just individual skills

## Multi-Skill Eval Files

- [ ] If one eval file tests multiple skills, document this clearly in the description
- [ ] Each test specifies which skill it targets via `type: file` input
- [ ] Consider splitting into separate eval files (one per skill) for clarity
