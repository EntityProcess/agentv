# @agentv/core

Core evaluation engine and runtime primitives for AgentV - a TypeScript-based AI agent evaluation and optimization framework.

## Overview

This package provides the foundational components for building and evaluating AI agents:

- **Provider Abstraction**: Unified interface for Azure OpenAI, Anthropic, Google Gemini, VS Code Copilot, and mock providers
- **Evaluation Engine**: YAML-based test specification and execution
- **Quality Grading**: AI-powered scoring system for comparing expected vs. actual outputs
- **Target Management**: Flexible configuration for different execution environments

## Installation

```bash
npm install @agentv/core
```

## Usage

This is a low-level package primarily used by the [agentv](https://www.npmjs.com/package/agentv) CLI. Most users should install the CLI package instead:

```bash
npm install -g agentv
```

For programmatic usage or custom integrations, you can import core components:

```typescript
import { createProvider, runEvaluation } from '@agentv/core';
```

## Features

### Multi-Provider Support

- **Azure OpenAI**: Enterprise-grade deployment support
- **Anthropic Claude**: Latest Claude models including Sonnet 4.5
- **Google Gemini**: Gemini 2.0 Flash and other models
- **VS Code Copilot**: Programmatic integration via subagent
- **Mock Provider**: Testing without API calls

### Evaluation Framework

- YAML-based test specifications
- Code block extraction and structured prompting
- Automatic retry handling for timeouts
- Detailed scoring with hit/miss analysis
- Multiple output formats (JSONL, YAML)

### Quality Grading

- AI-powered aspect extraction and comparison
- Normalized scoring (0.0 to 1.0)
- Detailed reasoning and analysis
- Configurable grading models

## Architecture

Built on modern TypeScript tooling:

- **Vercel AI SDK**: Direct Azure OpenAI, Anthropic, and Google Gemini integrations
- **Zod**: Runtime type validation
- **YAML**: Configuration and test specifications

## Documentation

For complete documentation, examples, and CLI usage, see the [agentv](https://www.npmjs.com/package/agentv) package.

## Repository

[https://github.com/EntityProcess/agentv](https://github.com/EntityProcess/agentv)

## License

MIT License - see [LICENSE](../../LICENSE) for details.
