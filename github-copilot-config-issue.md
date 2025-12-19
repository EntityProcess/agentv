# GitHub Copilot Configuration is Being Ignored

I have GitHub Copilot connected and configured in `oh-my-opencode.json`, but the configuration is not being respected for certain agents.

## Configuration File
**Location:** `C:\Users\Christopher.Tso\.config\opencode\oh-my-opencode.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "agents": {
    "Sisyphus": {
      "model": "github-copilot/gpt-5.2"
    },
    "librarian": {
      "model": "github-copilot/gpt-5.2"
    },
    "oracle": {
      "model": "github-copilot/gpt-5.2"
    },
    "frontend-ui-ux-engineer": {
      "model": "github-copilot/gpt-5.2"
    },
    "document-writer": {
      "model": "github-copilot/gpt-5.2"
    },
    "multimodal-looker": {
      "model": "github-copilot/gpt-5.2"
    }
  }
}
```

## Test Results

I created dummy tasks for each subagent to verify configuration:

**✅ Working (but possibly using wrong model):**
- **explore** - Successfully returned response (5s)
- **multimodal-looker** - Successfully returned response
- **frontend-ui-ux-engineer** - Completed successfully
- **document-writer** - Completed successfully

**❌ Failed:**
- **oracle** - Hard failure with `ProviderModelNotFoundError: ProviderModelNotFoundError`
- **librarian** - Completed but returned "(No assistant response found)" - silent failure

## Root Cause Analysis

The agents appear to be using **two different routing mechanisms**:

1. **explore & librarian** - Routed through `call_omo_agent` tool which appears to have its own separate model configuration, **ignoring the oh-my-opencode.json file**
2. **oracle, frontend-ui-ux-engineer, document-writer, multimodal-looker** - Using the `task` tool which reads from oh-my-opencode.json but fails with `ProviderModelNotFoundError` when trying to use `github-copilot/gpt-5.2`

## Key Issues

1. **Inconsistent configuration routing** - Some agents (explore/librarian via call_omo_agent) ignore the oh-my-opencode.json configuration entirely
2. **Invalid model identifier** - `github-copilot/gpt-5.2` causes `ProviderModelNotFoundError` for agents that DO read the config (oracle, etc.)
3. **No clear documentation** - It's unclear:
   - What the correct model identifier format should be for GitHub Copilot models
   - Where explore/librarian get their model configuration from
   - How to properly configure all agents to use GitHub Copilot models

## Questions

1. What is the correct model identifier format for GitHub Copilot models? (e.g., is it `github-copilot/gpt-4`, `copilot-gpt-4`, something else?)
2. Where is the model configuration for `explore` and `librarian` agents actually stored if they ignore oh-my-opencode.json?
3. How can we ensure ALL agents consistently use the configured GitHub Copilot models?

## Environment
- Windows 11
- GitHub Copilot: Connected and working
- OhMyOpenCode: Latest version
