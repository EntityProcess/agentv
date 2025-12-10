# Proposal: Rename output_messages Template Variable to expected_messages

## Summary

Rename the LLM judge template variable from `{{ output_messages }}` to `{{ expected_messages }}` for consistency with eval file schema and clearer semantics.

## Problem

The template variable name `output_messages` is inconsistent and confusing:
- **Eval schema uses**: `expected_messages` field (not `output_messages`)
- **Validation checks for**: `{{ expected_messages }}` template variable
- **Documentation shows**: `{{output_messages}}` as available variable
- **Name is ambiguous**: "output" could refer to agent output or expected output

This inconsistency creates confusion when writing custom evaluator templates.

## Solution

Rename `output_messages` to `expected_messages` throughout the codebase:
1. Template variable substitution in evaluators
2. Documentation references
3. Keep backward compatibility during transition (optional - TBD)

## Impact

### User Impact
- **Breaking Change**: Existing custom evaluator templates using `{{ output_messages }}` will need updates
- **Migration Path**: Users must update their templates to use `{{ expected_messages }}`
- **Documentation**: All examples and guides updated to reflect new name

### System Impact
- **Code Changes**: Update variable name in evaluator template substitution
- **Documentation**: Update custom-evaluators.md and related docs
- **Tests**: Update test fixtures and expectations

## Scope

### In Scope
- Rename template variable in `evaluators.ts` 
- Update documentation in `.claude/skills/agentv-eval-builder/references/custom-evaluators.md`
- Update any example evaluator templates
- Validation already checks for `expected_messages` (no change needed)

### Out of Scope
- Backward compatibility support (decide if needed)
- Changes to eval file schema (already uses `expected_messages`)
- Changes to validation logic (already correct)

## Questions for Decision

1. **Backward Compatibility**: Should we support both `{{ output_messages }}` and `{{ expected_messages }}` temporarily?
   - **Option A**: Breaking change - only support new name
   - **Option B**: Support both with deprecation warning
   - **Recommendation**: Option A (breaking change) - simpler, cleaner

2. **Migration Timing**: When to release this change?
   - Should coordinate with next major/minor version
   - Include in release notes with migration guide
