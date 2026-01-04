## ADDED Requirements
### Requirement: Canonical Evaluator Wire Schema
The system SHALL define a canonical evaluator payload schema with snake_case wire keys and a versioned envelope.

#### Scenario: Emit versioned payload to evaluator
- **WHEN** the runtime invokes a code_judge evaluator
- **THEN** it emits a JSON payload that conforms to the canonical schema
- **AND** the payload includes a `schema_version` field
- **AND** field names are snake_case in the wire format

#### Scenario: Validate evaluator payloads
- **WHEN** a payload is emitted to a custom evaluator
- **THEN** the system can validate the payload against the canonical schema
- **AND** invalid payloads are reported with actionable errors

### Requirement: Optional Language SDKs
The system SHALL provide optional, idiomatic SDKs for evaluator authors in TypeScript and Python.

#### Scenario: TypeScript SDK mapping
- **WHEN** a TS evaluator uses the SDK types
- **THEN** the SDK exposes camelCase types and maps them to the snake_case wire schema

#### Scenario: Python SDK mapping
- **WHEN** a Python evaluator uses the SDK types
- **THEN** the SDK exposes snake_case models that serialize directly to the wire schema
