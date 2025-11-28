## ADDED Requirements

### Requirement: Multi-Turn Message History Formatting

The system SHALL format `input_messages` to preserve conversation turn boundaries when there is actual conversational structure requiring role disambiguation.

#### Scenario: Single system and user message (backward compatibility)

- **WHEN** an eval case has one system message with text content and one user message in `input_messages`
- **THEN** the `raw_request.question` field contains the system text followed by the user message content, flattened without role markers
- **AND** maintains current backward-compatible behavior

#### Scenario: System file attachment with user message (no role markers needed)

- **WHEN** an eval case has a system message with only file attachments (no text content) and a user message
- **THEN** files ending in `.instructions.md` are extracted to `raw_request.guidelines`
- **AND** the `raw_request.question` field contains only the user message text without role markers
- **AND** the system message contributes no text to the question field

#### Scenario: Multi-turn conversation with non-user messages

- **WHEN** an eval case has `input_messages` including one or more non-user messages (assistant, tool, etc.)
- **THEN** the `raw_request.question` field contains all messages formatted with clear turn boundaries
- **AND** each turn is prefixed with its role (`[System]:`, `[User]:`, `[Assistant]:`, `[Tool]:`) on its own line
- **AND** file attachments in content blocks are embedded inline within their respective turn
- **AND** blank lines separate consecutive turns for readability

#### Scenario: Multi-turn with file references and guidelines

- **WHEN** an eval case includes file references (type: file) in multi-turn `input_messages`
- **THEN** files ending in `.instructions.md` are extracted and added to `raw_request.guidelines`
- **AND** other files are embedded inline within their respective message turn
- **AND** the formatting clearly shows which files belong to which turn

### Requirement: Role Marker Decision Logic

The system SHALL determine whether to use role markers based on conversational structure.

#### Scenario: Detecting when role markers are needed

- **WHEN** processing `input_messages` for formatting
- **THEN** role markers are used if and only if:
  - One or more non-user messages (assistant, tool, etc.) are present in `input_messages`, OR
  - Multiple messages have text content after extracting `.instructions.md` files to guidelines
- **AND** otherwise the flat format without role markers is used

#### Scenario: Preserving message order

- **WHEN** `input_messages` contains messages in a specific order
- **THEN** the formatted `question` field preserves that exact order
- **AND** the final message role (typically user) appears last before the expected assistant response
