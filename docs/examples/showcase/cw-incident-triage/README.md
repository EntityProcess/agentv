# CargoWise Incident Triage Showcase

Demonstrates evaluation of company-specific processes using the CR1-CR9 criticality rating system for support ticket classification.

## Key Challenge

The critical test case is `cr-missing-validation-disguised-as-defect` - where users label issues as "Critical Bug" but the system works as documented. The AI must correctly classify this as CR6 (feature request) by prioritizing specification over user perception.

## Purpose

Used for experimenting with prompt optimization methods on domain-specific classification tasks that require:
- Encoding proprietary business logic
- Handling edge cases between defects and feature requests
- Making documentation-driven decisions rather than following user labels
