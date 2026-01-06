# AgentV vs. Related Frameworks

## Quick Comparison

| Aspect | **AgentV** | **Langfuse** | **LangSmith** | **LangWatch** | **Google ADK** | **Mastra** | **OpenCode Bench** |
|--------|-----------|-----------|-----------|-----------|-----------|-----------|-----------|
| **Primary Focus** | Agent evaluation & testing | Observability + evaluation | Observability + evaluation | LLM ops & evaluation | Agent development | Agent/workflow development | Coding agent benchmarking |
| **Language** | TypeScript/CLI | Python/JavaScript | Python/JavaScript | Python/JavaScript | Python | TypeScript | Python/CLI |
| **Deployment** | Local (CLI-first) | Cloud/self-hosted | Cloud only | Cloud/self-hosted/hybrid | Local/Cloud Run | Local/server | Benchmarking service |
| **Self-contained** | ✓ Yes | ✗ Requires server | ✗ Cloud-only | ✗ Requires server | ✓ Yes | ✓ Yes (optional) | ✗ Requires service |
| **Evaluation Focus** | ✓ Core feature | ✓ Yes | ✓ Yes | ✓ Core feature | ✗ Minimal | ✗ Secondary | ✓ Core feature |
| **Judge Types** | Code + LLM (custom prompts) | LLM-as-judge only | LLM-based + custom | LLM + real-time | Built-in metrics | Built-in (minimal) | Multi-judge LLM (3 judges) |
| **CLI-First** | ✓ Yes | ❌ Dashboard-first | ❌ Dashboard-first | ❌ Dashboard-first | ❌ Code-first | ❌ Code-first | ❌ Service-based |
| **Open Source** | ✓ MIT | ✓ Apache 2.0 | ❌ Closed | ❌ Closed | ✓ Apache 2.0 | ✓ MIT | ✓ Open source |
| **Setup Time** | < 2 min | 15+ min | 10+ min | 20+ min | 30+ min | 10+ min | 5-10 min (CLI) |
| **Local Iteration Speed** | ⚡ Instant (evals) | ⚠️ UI-mediated | ⚠️ API calls | ⚠️ UI-mediated | ⚡ Instant (agents) | ⚡ Instant (code) | ⚠️ 30+ min per run |
| **Deterministic Evaluation** | ✓ Code judges | ✗ (LLM-biased) | ✗ (LLM-biased) | ✗ (LLM-biased) | ✓ Built-in | ~ (Custom code) | ✗ (LLM-based) |
| **Real-World Tasks** | ~ (Your data) | ~ (Your data) | ~ (Your data) | ~ (Your data) | ~ (Your design) | N/A (agent building) | ✓ GitHub commits |

---

## Technical Differences

### How AgentV Works

**1. Hybrid Judge System (Code + LLM with Custom Prompts)**
```yaml
execution:
  evaluators:
    - name: format_check
      type: code_judge           # Deterministic: checks concrete outputs
      script: ./validators/check_format.py

    - name: correctness
      type: llm_judge            # Subjective: uses customizable judge prompt
      prompt: ./judges/correctness.md  # Edit the prompt, not the code
```

This is more powerful than:
- **Langfuse**: LLM judges only, limited prompt customization via API
- **LangSmith**: LLM-biased, requires SDK modifications for custom logic
- **LangWatch**: UI-driven prompt customization (not version-controlled)
- **Google ADK**: Not focused on evaluation (agent development framework)

**Why this matters:**
- Code judges catch objective failures (syntax errors, missing fields, wrong format)
- LLM judges handle subjective criteria (tone, helpfulness, reasoning quality)
- Customizable prompts = iterate on eval criteria without code changes
- All version-controlled in Git alongside your evals

**2. Local-First Workflow**
No network round-trips, no waiting for managed infrastructure:
- Edit eval YAML → Run → Get results in seconds
- Iteration speed: **Code judges (instant) + LLM judges (1-2 sec per case)**
- Compare to Langfuse/LangWatch: UI clicks + backend processing

**3. CLI-Native, Not UI-Native**
```bash
# AgentV workflow
agentv eval evals/my-eval.yaml
agentv eval evals/**/*.yaml --workers 10  # Parallel
agentv compare before.jsonl after.jsonl   # A/B testing
```

```bash
# Langfuse/LangWatch workflow
# 1. Log in to web UI
# 2. Create evaluation in UI
# 3. Configure judges in UI
# 4. Run evaluation
# 5. View results in dashboard
```

AgentV integrates into:
- **CI/CD pipelines** (`agentv eval evals/ --out results.jsonl`)
- **Git hooks** (block PRs if eval scores drop)
- **Scripts** (parse JSONL results, trigger alerts)
- **Notebooks** (iterate on eval logic)

**4. Zero Infrastructure Overhead**
```bash
npm install -g agentv
agentv init
agentv eval evals/example.yaml
# Done. No Docker, no K8s, no managed service.
```

vs Langfuse:
```bash
docker-compose up -d  # Spin up managed infrastructure
# Configure database, API keys
# Wait for services to start
# Create evaluations in web UI
# ...
```

---

## Practical Use Cases

### Scenario: Iterating on Eval Criteria

```markdown
# judges/correctness.md (edit locally, version in Git)
Evaluate if the answer is mathematically correct.

## Scoring
- 1.0: Correct answer with clear reasoning
- 0.8: Correct answer, reasoning unclear
- 0.5: Partially correct
- 0.0: Wrong answer
```

Then re-run: `agentv eval evals/math.yaml`

Alternative approaches:
- Langfuse/LangWatch: Go to UI, modify prompt, save, re-run
- LangSmith: Modify SDK code, redeploy
- Google ADK: Modify Python code, rerun framework

### Scenario: Deterministic + Subjective Evaluation

```yaml
judges:
  - type: code
    name: syntax_check
    command: "python check_syntax.py"
  - type: code
    name: logic_check
    command: "python check_logic.py"
  - type: llm
    name: explanation_quality
    judge_file: "judges/explanation.md"
```

Single eval run scores all three dimensions. Other approaches:
- Langfuse: LLM judges only (no deterministic checks)
- LangSmith: Requires custom evaluation SDK calls
- LangWatch: UI judges only (mixing code + UI-driven)

### Scenario: Reproducible Local Evals in CI/CD

```yaml
# .github/workflows/eval.yml
- run: agentv eval evals/**/*.yaml --out results.jsonl
- run: agentv compare baseline.jsonl results.jsonl --threshold 0.05
  # Fail if performance drops > 5%
```

Other tools face challenges here:
- Langfuse/LangWatch: Require external service (not CI-friendly)
- LangSmith: Cloud-only, no local execution
- Google ADK: Not designed for evals

### Scenario: Fast Iteration Feedback Loop

```
Edit eval → Save → agentv eval (1-2 sec) → Review results
vs
Edit in UI → Click Save → Wait for backend → Refresh dashboard (10-20 sec)
```

Other tools:
- Langfuse: UI-mediated (slower feedback loop)
- LangSmith: SDK calls + cloud latency
- LangWatch: UI-mediated (slower)
- Google ADK: Code compilation/rerun

---

## Trade-offs and Alternatives

### Production Monitoring & Observability
**Use Langfuse, LangSmith, or LangWatch instead**

AgentV evaluates static test cases. It doesn't:
- ✗ Capture production traces
- ✗ Monitor LLM call latency in production
- ✗ Alert on failures in real-world usage
- ✗ Track cost-per-request

**Recommendation:** Use AgentV for development → Langfuse/LangWatch for production

### Team Collaboration & Dashboards
**Use LangWatch or Langfuse instead**

AgentV is single-developer focused:
- ✗ No web dashboard
- ✗ No multi-user collaboration UI
- ✗ No annotation/review workflows
- ✗ No role-based access control

### Prompt Optimization

**AgentV approach:**
- ✓ Has a prompt optimization skill that leverages coding agents
- ✓ Agents iteratively improve prompts based on eval results
- ✓ Lightweight and integrated with your eval workflow

**LangWatch approach:**
- ✓ Built-in MIPROv2 automatic optimization
- Requires team collaboration features and managed service

### Prompt Version Control & Management
**Use Langfuse instead**

Langfuse has:
- ✓ Centralized prompt versioning
- ✓ A/B testing UI
- ✓ Automatic caching

AgentV approach: Store judge prompts in Git, manage manually

---

## Direct Comparisons

### AgentV vs. Langfuse

| Feature | AgentV | Langfuse |
|---------|--------|----------|
| **Evaluation** | Code + LLM (custom prompts) | LLM only |
| **Local execution** | ✓ Yes | ✗ (requires server) |
| **Speed** | Fast (no network) | Slower (API round-trips) |
| **Setup** | `npm install` | Docker + database |
| **Cost** | Free | Free + $299+/mo for production |
| **Observability** | ✗ No | ✓ Full tracing |
| **Collaboration** | ✗ No | ✓ Team UI |
| **Custom judge prompts** | ✓ Version in Git | ~ (API-based) |
| **CI/CD ready** | ✓ Yes | ~ (Requires API calls) |

**Choose AgentV if:** You iterate locally on evals, need deterministic + subjective judges together
**Choose Langfuse if:** You need production observability + team dashboards

---

### AgentV vs. LangWatch

| Feature | AgentV | LangWatch |
|---------|--------|-----------|
| **Evaluation focus** | Development-first | Team collaboration first |
| **Execution** | Local | Cloud/self-hosted server |
| **Custom judge prompts** | ✓ Markdown files (Git) | ✓ UI-based |
| **Code judges** | ✓ Yes | ✗ LLM-focused |
| **Prompt optimization** | ✓ Via skill + agents | ✓ Built-in MIPROv2 |
| **Setup** | < 2 min | 20+ min |
| **Iteration speed** | ⚡ Instant | ⚠️ UI-mediated |
| **Team features** | ✗ No | ✓ Annotation, roles, review |

**Choose AgentV if:** You develop locally, want fast iteration, prefer code judges, need lightweight optimization
**Choose LangWatch if:** You need team collaboration, managed optimization, on-prem deployment

---

### AgentV vs. LangSmith

| Feature | AgentV | LangSmith |
|---------|--------|-----------|
| **Evaluation** | Code + LLM custom | LLM-based (SDK) |
| **Deployment** | Local (no server) | Cloud only |
| **Framework lock-in** | None | LangChain ecosystem |
| **Open source** | ✓ MIT | ✗ Closed |
| **Setup** | Minimal | Requires API key + SDK setup |
| **Local execution** | ✓ Yes | ✗ (requires API calls) |
| **Observability** | ✗ No | ✓ Full tracing |
| **Production ready** | ✗ (dev tool) | ✓ Yes |

**Choose AgentV if:** You want local evaluation, deterministic judges, open source
**Choose LangSmith if:** You're LangChain-heavy, need production tracing

---

### AgentV vs. Google ADK

| Feature | AgentV | Google ADK |
|---------|--------|-----------|
| **Purpose** | Evaluation | Agent development |
| **Evaluation capability** | ✓ Comprehensive | ~ (Built-in metrics only) |
| **Judge customization** | ✓ Code + LLM prompts | ✗ Limited |
| **Setup** | < 2 min | 30+ min |
| **Code-first** | ✗ YAML-first | ✓ Python-first |
| **Learning curve** | Low | High |
| **Multi-agent support** | ✗ (tests agents) | ✓ (builds agents) |
| **Deployment options** | Local | Local + Cloud Run |

**Choose AgentV if:** You need to evaluate agents (not build them)
**Choose Google ADK if:** You're building multi-agent systems and need development framework

---

### AgentV vs. Mastra

| Feature | AgentV | Mastra |
|---------|--------|--------|
| **Purpose** | Agent evaluation & testing | Agent/workflow development framework |
| **Language** | TypeScript (CLI-native) | TypeScript (code-native) |
| **Evaluation** | ✓ Core focus (code + LLM judges) | ~ (Secondary, built-in only) |
| **Judge Customization** | ✓ High (custom prompts, code judges) | ✗ Fixed built-in metrics |
| **Agent Building** | ✗ (Tests agents) | ✓ (Builds agents with tools, workflows) |
| **Workflow Orchestration** | ✗ No | ✓ Yes (`.then()`, `.branch()`, `.parallel()`) |
| **Model Routing** | ✗ (External) | ✓ (40+ providers unified) |
| **Context Management** | ✗ No | ✓ (Memory, RAG, history) |
| **Setup Time** | < 2 min | 10+ min |
| **Setup Complexity** | Minimal | Medium (npm + TypeScript) |
| **Evaluation Iteration Speed** | ⚡ Instant | ⚠️ Code change + rerun |
| **Open Source** | ✓ MIT | ✓ MIT |

**Key Difference:**
- **AgentV**: Specialized tool for evaluating agents (any language, any agent type)
- **Mastra**: Full framework for building AI agents in TypeScript

**Complementary Use:**
```
Mastra (build TypeScript agents)
    ↓
AgentV (evaluate your agents with custom criteria)
    ↓
Mastra (deploy agents in production)
```

**Choose AgentV if:** You need to test/evaluate agents, fast iteration on metrics, mix of deterministic + subjective scoring
**Choose Mastra if:** You're building TypeScript AI agents and need orchestration, context management, multiple LLM providers

---

### AgentV vs. OpenCode Bench

| Feature | AgentV | OpenCode Bench |
|---------|--------|---------|
| **Purpose** | General agent evaluation (any task) | Benchmarking coding agents on real GitHub commits |
| **Task Source** | You define tasks/expected outcomes | Pre-curated GitHub production commits |
| **Judge Type** | Code + LLM (customizable) | Multi-judge LLM (3 judges, fixed) |
| **Scoring Dimensions** | You define (custom rubrics) | 5 fixed: API compliance, logic, integration, tests, checks |
| **Execution** | Local (seconds) | Remote (30+ min per run) |
| **Variance Handling** | Single run | 3 runs per task (episode isolation) + variance penalties |
| **Setup** | < 2 min | 5-10 min CLI setup |
| **Customization** | High (custom judges, prompts, metrics) | Low (fixed benchmark) |
| **Use Case** | Develop & iterate on evals | Compare agents against standard benchmark |

**Key Difference:**
- **AgentV**: Build custom evaluations for your specific needs, iterate quickly locally
- **OpenCode Bench**: Standardized benchmark to rank coding agents against production GitHub tasks

**Complementary Use:**
```
AgentV → Develop your agent → Evaluate locally with custom rubrics
OpenCode Bench → When ready, submit to public benchmark for objective ranking
```

**Choose AgentV if:** You need custom evaluation criteria, fast iteration, control over tasks
**Choose OpenCode Bench if:** You want standard benchmark ranking, reproducible comparison, real-world GitHub tasks

---

## Recommended Marketing Message

### For Developers
> **"Evaluate your agents like you write code. No dashboards. No infrastructure. Just YAML + judges you version control."**

- Fast local iteration on eval criteria
- Code judges for deterministic checks + LLM judges for subjective scoring
- All evals in Git, every change traceable
- Integrates with CI/CD pipelines naturally

### For Teams
> **"AgentV for local development, Langfuse for production monitoring."**

Use AgentV to:
- Iterate on evaluations fast
- Run tests in CI/CD
- Maintain eval criteria in Git
- Catch regressions before deploy

Then use Langfuse/LangWatch in production for observability.

### For Open-Source Projects
> **"Evaluation infrastructure without vendor lock-in. Free, open source, zero infrastructure."**

- No managed service dependencies
- Fork-friendly (self-contained)
- Contribute evaluation criteria to your project
- MIT licensed

---

## Summary: When to Use AgentV

✓ **Use AgentV if you:**
- Iterate on evals locally
- Want deterministic + subjective judges together
- Prefer code judges over LLM-only
- Need version-controlled eval criteria
- Integrate evals into CI/CD
- Dislike managed infrastructure
- Want reproducible, Git-friendly evaluations

✗ **Don't use AgentV for:**
- Production observability → Use Langfuse or LangWatch
- Team collaboration dashboards → Use LangWatch or Langfuse
- Building agents → Use Mastra (TypeScript) or Google ADK (Python)
- Intricate production tracing → Use LangSmith
- Standardized benchmarking → Use OpenCode Bench

**Sweet spot:** Individual developers and teams that evaluate locally before deploying to production, and who need custom evaluation criteria tailored to their specific use case. Pairs naturally with Mastra and Google ADK for end-to-end development workflows.

---

## Ecosystem Recommendation

**Development to Production Pipeline:**

```
TypeScript Agents:
  Mastra (build agents & workflows)
      ↓
  AgentV (test & iterate locally)
      ↓
  AgentV (CI/CD: block regressions)
      ↓
  Langfuse/LangWatch (production monitoring)

Python Agents:
  Google ADK (build multi-agent systems)
      ↓
  AgentV (test & iterate locally)
      ↓
  AgentV (CI/CD: block regressions)
      ↓
  Langfuse/LangWatch (production monitoring)

Coding Agents (Optional):
  AgentV (dev evals) → OpenCode Bench (public ranking) → production
```

**Role of Each Tool:**
- **Mastra/Google ADK**: Build your agents
- **AgentV**: Evaluate agents locally with custom criteria, block regressions in CI/CD
- **OpenCode Bench**: Optional—submit coding agents to standardized public benchmark
- **Langfuse/LangWatch**: Monitor agents in production, alerting and observability

AgentV is the glue in your evaluation pipeline; it sits naturally between development frameworks and production monitoring.
