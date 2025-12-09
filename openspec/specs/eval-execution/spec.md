# eval-execution Specification

## Purpose
Define how eval execution formats `input_messages` into the `question` string (and optional `chatPrompt`) for candidates and evaluators, preserving turn boundaries with role markers when needed while keeping a flat format for single-message inputs.
## Requirements
### Requirement: Message Formatting

The system SHALL format `input_messages` to preserve turn order and visible content, adding role markers when multiple messages contribute content.

#### Scenario: Two-message conversation uses role markers

- **WHEN** an eval case has a system message with text content and a user message
- **THEN** the formatted `question` contains both turns, each prefixed with `@[System]:` and `@[User]:` on separate lines and separated by a blank line
- **AND** guideline files remain in the `guidelines` field rather than being inlined into the question text

#### Scenario: Single visible message stays flat

- **WHEN** only one input message contains visible content after guideline extraction
- **THEN** the formatted `question` is the message content without any role markers
- **AND** guideline references appear as `<Attached: path>` markers when present

#### Scenario: System file attachment with user message

- **WHEN** a system message contains only file attachments and a user message contains text
- **THEN** `.instructions.md` files from the system turn are moved to `guidelines`
- **AND** the formatted `question` uses role markers with the system turn containing the remaining file content and the user turn containing the user text

#### Scenario: Multi-turn conversation with non-user messages

- **WHEN** `input_messages` include assistant or tool messages
- **THEN** each turn in the formatted `question` is prefixed with its role using the `@[Role]:` marker on its own line
- **AND** file attachments render inside their originating turn (`<file path=\"...\">…</file>` in LM mode, `<file: path=\"...\">` in agent mode)
- **AND** blank lines separate consecutive turns for readability

#### Scenario: Multi-turn with file references and guidelines

- **WHEN** multi-turn input contains file references and guideline files
- **THEN** guideline files are added to `guidelines` while file content stays inline with the originating turn in the `question`
- **AND** guideline references in the conversation remain visible as `<Attached: path>` markers tied to the originating turn

### Requirement: Role Marker Decision Logic

The system SHALL decide when to apply role markers based on message content.

#### Scenario: Detecting when role markers are needed

- **WHEN** processing `input_messages` for formatting
- **THEN** role markers are used if and only if there is at least one assistant/tool message **OR** more than one message contains visible content after guideline extraction
- **AND** otherwise the flat format without role markers is used

#### Scenario: Preserving message order

- **WHEN** `input_messages` are formatted
- **THEN** the original message order is preserved in the `question`
- **AND** the final user turn (or last message role) remains last in the formatted output

### Requirement: Evaluator Prompt Formatting

The system SHALL feed evaluators the same formatted question used for candidates.

#### Scenario: Multi-turn conversation evaluation

- **WHEN** an evaluator scores a candidate answer for a multi-turn conversation
- **THEN** the evaluator prompt includes the `question` string with `@[Role]:` markers under the `[[ ## question ## ]]` section of the evaluator template
- **AND** guidelines are not duplicated into the evaluator prompt beyond any `<Attached: ...>` references already present

#### Scenario: Single-turn conversation evaluation

- **WHEN** an evaluator scores a single-message interaction
- **THEN** the evaluator prompt contains the flat `question` string without role markers
- **AND** maintains backward compatibility with existing single-turn runs

#### Scenario: Evaluator receives same context as candidate

- **WHEN** building the evaluator prompt
- **THEN** the `question` text passed to the evaluator matches exactly the `question` sent to the candidate provider
- **AND** the evaluator can rely on the same turn structure the candidate saw
