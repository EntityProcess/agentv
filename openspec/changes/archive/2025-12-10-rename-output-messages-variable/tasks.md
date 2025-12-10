# Tasks: Rename output_messages Template Variable

## Implementation Tasks

- [ ] Update variable name in `packages/core/src/evaluation/evaluators.ts` (line ~105)
  - Change `output_messages` to `expected_messages` in template variable substitution
- [ ] Update documentation in `.claude/skills/agentv-eval-builder/references/custom-evaluators.md`
  - Change `{{output_messages}}` to `{{expected_messages}}` in template variables list
- [ ] Search for any other references to `output_messages` in documentation
  - Check README files
  - Check example evaluator templates
  - Check inline code comments
- [ ] Update tests if they reference the old variable name
  - Check test fixtures
  - Check test assertions
- [ ] Verify validation still works correctly (already checks for `expected_messages`)

## Validation

- [ ] All unit tests pass
- [ ] Lint passes (`pnpm lint`)
- [ ] TypeScript compilation passes (`pnpm typecheck`)
- [ ] Custom evaluator templates work with `{{ expected_messages }}`
- [ ] Documentation accurately reflects the change
- [ ] No references to `output_messages` remain in user-facing content

## Migration Notes

- **Breaking Change**: Existing custom evaluator templates using `{{ output_messages }}` will need to be updated
- Include in release notes with clear migration instructions
- Consider version bump (minor or major depending on project versioning policy)
