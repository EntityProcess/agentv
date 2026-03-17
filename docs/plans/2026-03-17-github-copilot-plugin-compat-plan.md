# GitHub Copilot Plugin Compatibility — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `.github/plugin/` structure so the agentv plugin is discoverable by VS Code GitHub Copilot alongside existing Claude Code support.

**Architecture:** Two new JSON files create the GitHub Copilot discovery layer. The root `.github/plugin/marketplace.json` lists available plugins. Each plugin gets a `.github/plugin/plugin.json` manifest. All existing files stay untouched.

**Tech Stack:** JSON manifests, no code changes.

---

### Task 1: Create root `.github/plugin/marketplace.json`

**Files:**
- Create: `.github/plugin/marketplace.json`

**Step 1: Create the directory and file**

```bash
mkdir -p .github/plugin
```

Then create `.github/plugin/marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "agentv-dev",
      "source": "agentv-dev",
      "description": "Development skills for building and optimizing AgentV evaluations",
      "version": "1.0.0"
    }
  ]
}
```

**Step 2: Validate JSON is well-formed**

Run: `python3 -c "import json; json.load(open('.github/plugin/marketplace.json')); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add .github/plugin/marketplace.json
git commit -m "feat: add .github/plugin/marketplace.json for VS Code Copilot discovery"
```

---

### Task 2: Create per-plugin `.github/plugin/plugin.json`

**Files:**
- Create: `plugins/agentv-dev/.github/plugin/plugin.json`

**Step 1: Create the directory and file**

```bash
mkdir -p plugins/agentv-dev/.github/plugin
```

Then create `plugins/agentv-dev/.github/plugin/plugin.json`:

```json
{
  "name": "agentv-dev",
  "description": "Development skills for building and optimizing AgentV evaluations",
  "version": "1.0.0",
  "author": {
    "name": "AgentV"
  },
  "repository": "https://github.com/EntityProcess/agentv",
  "license": "MIT",
  "keywords": [
    "eval",
    "testing",
    "agent",
    "benchmarks"
  ],
  "agents": [
    "./agents"
  ],
  "skills": [
    "./skills/agentv-bench",
    "./skills/agentv-eval-analyzer",
    "./skills/agentv-eval-writer",
    "./skills/agentv-onboarding",
    "./skills/agentv-trace-analyst"
  ]
}
```

**Step 2: Validate JSON is well-formed**

Run: `python3 -c "import json; json.load(open('plugins/agentv-dev/.github/plugin/plugin.json')); print('OK')"`
Expected: `OK`

**Step 3: Verify agent and skill paths resolve**

Run: `ls plugins/agentv-dev/agents/ && ls -d plugins/agentv-dev/skills/agentv-bench plugins/agentv-dev/skills/agentv-eval-analyzer plugins/agentv-dev/skills/agentv-eval-writer plugins/agentv-dev/skills/agentv-onboarding plugins/agentv-dev/skills/agentv-trace-analyst`
Expected: All paths exist, no errors.

**Step 4: Commit**

```bash
git add plugins/agentv-dev/.github/plugin/plugin.json
git commit -m "feat: add agentv-dev plugin.json for VS Code Copilot compatibility"
```

---

### Task 3: Verify dual compatibility

**Step 1: Confirm Claude Code marketplace is untouched**

Run: `cat .claude-plugin/marketplace.json | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d['plugins'])==2; print('Claude Code: OK')"`
Expected: `Claude Code: OK`

**Step 2: Confirm GitHub Copilot marketplace is valid**

Run: `cat .github/plugin/marketplace.json | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['plugins'][0]['name']=='agentv-dev'; print('GitHub Copilot: OK')"`
Expected: `GitHub Copilot: OK`

**Step 3: Confirm per-plugin manifest references resolve**

Run: `python3 -c "
import json, os
p = json.load(open('plugins/agentv-dev/.github/plugin/plugin.json'))
base = 'plugins/agentv-dev'
for a in p['agents']:
    path = os.path.join(base, a)
    assert os.path.isdir(path), f'Missing: {path}'
for s in p['skills']:
    path = os.path.join(base, s, 'SKILL.md')
    assert os.path.isfile(path), f'Missing: {path}'
print('All paths resolve: OK')
"`
Expected: `All paths resolve: OK`
