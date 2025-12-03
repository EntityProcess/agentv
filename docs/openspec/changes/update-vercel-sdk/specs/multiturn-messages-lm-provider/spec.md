## MODIFIED Requirements

### Requirement: AxProvider Baseline Implementation

The multi-turn chat prompt handling SHALL be implemented in a provider-agnostic helper that is reused by all Vercel AI–backed providers instead of being tied to Ax-specific types.

#### Scenario: Shared chatPrompt builder used by Vercel AI providers

- **WHEN** Azure, Anthropic, or Gemini providers receive a `ProviderRequest`
- **THEN** they delegate to a shared chat prompt builder to construct the `chatPrompt` array based on `input_messages`, system prompts, guidelines, and file attachments
- **AND** the resulting `chatPrompt` obeys all existing scenarios in the `multiturn-messages-lm-provider` spec (system message merging, guideline extraction, empty-message filtering)
- **AND** the providers pass this `chatPrompt` directly into the Vercel AI SDK chat calls without introducing Ax-specific types or behavior.
