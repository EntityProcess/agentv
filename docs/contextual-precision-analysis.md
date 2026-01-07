# Contextual Precision Implementation Analysis for AgentV

**Created:** 2026-01-07  
**Purpose:** Research how Contextual Precision from Confident AI can be implemented in AgentV

---

## Executive Summary

Contextual Precision is a RAG evaluation metric that measures how well a retrieval system ranks relevant context chunks in response to a query. Unlike simple presence checks, it evaluates **positional relevance** - whether the most useful information appears first. This analysis explores how this metric can be integrated into AgentV's evaluation framework.

**Key Findings:**
- Contextual Precision is a specialized RAG metric focused on retrieval ranking quality
- AgentV already has extensible evaluation primitives (field_accuracy, tool_trajectory, code_judge, llm_judge)
- Implementation should follow AgentV's design principles: plugin-based for niche use cases, not built-in
- Recommended approach: Provide as example code evaluator in `examples/showcase/rag-evaluation/`

---

## What is Contextual Precision?

### Definition
Contextual Precision measures whether a retrieval system correctly **ranks** relevant context chunks, ensuring the most pertinent information appears first in the retrieved results.

### How It Works

**Inputs Required:**
- `input`: User's query
- `expected_output`: Ideal response to the query
- `retrieval_context`: Ranked list of retrieved context chunks

**Evaluation Process:**
1. Each retrieved chunk is evaluated by an LLM judge for relevance to the query
2. For each position `k`, calculate Precision@k weighted by relevance
3. Aggregate into final score

**Formula:**
```
Contextual Precision = (1 / R) × Σ(k=1 to N) [(Relevant_Nodes_up_to_k / k) × r_k]

where:
- R = Total number of relevant nodes
- r_k = 1 if node at position k is relevant, 0 otherwise
- N = Total retrieved nodes
```

**Score Interpretation:**
- **1.0**: Perfect ordering - all relevant chunks ranked first
- **0.5-0.9**: Good ordering with some irrelevant chunks interspersed
- **0.0-0.5**: Poor ordering - relevant chunks buried in results

### Why It Matters for RAG Systems

1. **Order Matters**: LLMs perform better when relevant context appears early
2. **Context Window Limits**: Most LLMs have limited context windows - top-ranked chunks get more attention
3. **Cost Efficiency**: Identifying poorly ranked retrievals helps optimize retriever algorithms
4. **Component Testing**: Isolates retrieval quality from generation quality

---

## AgentV Architecture Context

### Existing Evaluator Types

AgentV currently provides these built-in evaluators:

| Evaluator Type | Purpose | When to Use |
|---------------|---------|-------------|
| `llm_judge` | Freeform or rubric-based LLM evaluation | General semantic correctness |
| `code_judge` | Custom validation logic via scripts | Domain-specific checks |
| `field_accuracy` | Structured data extraction validation | JSON field extraction (e.g., invoice parsing) |
| `tool_trajectory` | Agent tool call sequence validation | Tool usage patterns |
| `latency` | Execution duration thresholds | Performance requirements |
| `cost` | Execution cost budgets | Cost control |
| `token_usage` | Token consumption limits | Token budget enforcement |
| `composite` | Combine multiple evaluators | Multi-dimensional evaluation |

### Design Principles (from Repository Guidelines)

**1. Lightweight Core, Plugin Extensibility**
- Core should remain minimal
- Complex or domain-specific logic belongs in plugins
- Extension points: `code_judge`, `llm_judge`, custom prompt files

**2. Built-ins for Primitives Only**
Built-in evaluators must be:
- Stateless and deterministic
- Single, clear responsibility
- Cannot be trivially composed from existing primitives
- Needed by the **majority** of users

**3. Align with Industry Standards**
- Research peer frameworks before adding features
- Prefer lowest common denominator covering most use cases
- Novel features without precedent require strong justification → default to plugin

**4. AI-First Design**
- Expose simple, single-purpose primitives that AI can combine flexibly
- Avoid monolithic commands doing multiple things

---

## Implementation Analysis

### Is Contextual Precision a Universal Primitive?

**Evaluation Against Built-in Criteria:**

❌ **Not needed by majority of users**
- Specialized for RAG evaluation only
- Most AgentV users evaluate general agent tasks, not retrieval systems
- Comparable to how `tool_trajectory` is built-in because tool usage is universal for agents

❌ **Can be composed from existing primitives**
- Core logic: LLM judge evaluating relevance + position-aware scoring
- Can be implemented as `code_judge` that wraps LLM calls
- Not fundamentally different from custom scoring logic

✅ **Industry precedent exists**
- Implemented in: DeepEval, Ragas, RagaAI Catalyst, Mastra
- Well-established in RAG evaluation community
- Standardized formula and interpretation

**Conclusion:** Contextual Precision fails the "universal primitive" test. While it has industry precedent, it serves a niche use case (RAG retrieval ranking) and can be composed from existing primitives.

### Comparison with Existing Evaluators

| Feature | Built-in Evaluator | Contextual Precision |
|---------|-------------------|---------------------|
| **Use Case Scope** | Universal (all agents) | Niche (RAG systems only) |
| **Composition** | Cannot compose from others | Composable (code_judge + LLM calls) |
| **User Demand** | High (majority need) | Low (RAG-specific) |
| **Complexity** | Simple, single responsibility | Multi-step: LLM relevance checks + position weighting |

**field_accuracy is built-in because:**
- Structured data extraction is common across many domains (invoices, forms, database records)
- Provides deterministic, stateless validation primitives (exact match, numeric tolerance, date parsing)
- Cannot be easily replicated with other evaluators without significant boilerplate

**Contextual Precision should be a plugin because:**
- RAG retrieval ranking is domain-specific
- Can be implemented via `code_judge` calling LLM APIs for relevance judgments
- Most AgentV users don't evaluate retrieval systems

---

## Recommended Implementation Approach

### Option 1: Example Code Evaluator (RECOMMENDED)

**Location:** `examples/showcase/rag-evaluation/`

**Why This Approach:**
- Follows AgentV principle: "Lightweight core, plugin extensibility"
- Demonstrates how to build specialized evaluators
- Users can copy/customize for their RAG needs
- No core maintenance burden

**Implementation Structure:**
```
examples/showcase/rag-evaluation/
├── evals/
│   └── retrieval-quality.yaml          # Example eval file
├── evaluators/
│   ├── contextual-precision.ts         # Core implementation
│   └── contextual-precision.test.ts    # Unit tests
├── agents/
│   └── mock-rag-provider.ts            # Mock RAG system for demo
└── README.md                            # Usage guide
```

**Example Eval File:**
```yaml
description: RAG retrieval quality evaluation

execution:
  target: mock_rag_system
  evaluators:
    - name: retrieval_ranking
      type: code_judge
      script: npx --yes tsx ./evaluators/contextual-precision.ts

evalcases:
  - id: medical-query-retrieval
    question: "What are the side effects of aspirin?"
    expected_outcome: "Retrieve relevant medical information about aspirin side effects"
    
    input_messages:
      - role: user
        content: "What are the side effects of aspirin?"
    
    expected_messages:
      - role: assistant
        content: |
          {
            "retrieved_context": [
              "Aspirin can cause stomach irritation and bleeding in some patients...",
              "Common side effects include nausea and heartburn...",
              "Aspirin is contraindicated for patients with bleeding disorders..."
            ]
          }
```

**Code Evaluator Implementation (TypeScript with @agentv/eval SDK):**
```typescript
#!/usr/bin/env bun
/**
 * Contextual Precision Evaluator for RAG Systems
 * 
 * Measures how well retrieved context is ranked by relevance.
 * 
 * Input:
 * - question: User query
 * - expected_messages: Contains expected retrieved_context array
 * - candidate_answer: Actual retrieved_context array (or full response)
 * 
 * Output:
 * - score: 0.0-1.0 (1.0 = perfect ranking)
 * - hits: Relevant chunks with positions
 * - misses: Irrelevant chunks or misranked items
 * - reasoning: Explanation of score
 */
import { defineCodeJudge } from '@agentv/eval';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

interface RelevanceCheck {
  position: number;
  chunk: string;
  relevant: boolean;
  reasoning: string;
}

export default defineCodeJudge(async ({ question, candidateAnswer, expectedOutcome }) => {
  // Parse retrieved context from candidate answer
  const retrievedContext = parseRetrievedContext(candidateAnswer);
  
  if (retrievedContext.length === 0) {
    return {
      score: 0,
      hits: [],
      misses: ['No retrieved context found in candidate answer'],
      reasoning: 'Cannot evaluate contextual precision without retrieved chunks',
    };
  }

  // Evaluate relevance of each chunk using LLM judge
  const relevanceChecks = await evaluateRelevance(question, retrievedContext);
  
  // Calculate contextual precision score
  const { score, hits, misses } = calculateContextualPrecision(relevanceChecks);
  
  const relevantCount = relevanceChecks.filter(c => c.relevant).length;
  const reasoning = `${relevantCount}/${retrievedContext.length} chunks relevant, precision score: ${score.toFixed(2)}`;

  return { score, hits, misses, reasoning };
});

function parseRetrievedContext(candidateAnswer: string): string[] {
  try {
    const parsed = JSON.parse(candidateAnswer);
    if (Array.isArray(parsed.retrieved_context)) {
      return parsed.retrieved_context;
    }
    // Handle other formats as needed
    return [];
  } catch {
    // Fallback: split by double newlines or other heuristics
    return [];
  }
}

async function evaluateRelevance(
  query: string,
  chunks: string[]
): Promise<RelevanceCheck[]> {
  const checks: RelevanceCheck[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    const prompt = `
You are evaluating retrieval quality for a RAG system.

Query: ${query}

Retrieved Context (Position ${i + 1}):
${chunk}

Is this context chunk relevant to answering the query?
Respond with JSON:
{
  "relevant": true/false,
  "reasoning": "1-2 sentence explanation"
}
`;

    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt,
      temperature: 0.1,
    });
    
    const result = JSON.parse(text);
    checks.push({
      position: i + 1,
      chunk: chunk.slice(0, 100) + '...',
      relevant: result.relevant,
      reasoning: result.reasoning,
    });
  }
  
  return checks;
}

function calculateContextualPrecision(
  checks: RelevanceCheck[]
): { score: number; hits: string[]; misses: string[] } {
  const hits: string[] = [];
  const misses: string[] = [];
  
  let relevantCount = 0;
  let weightedSum = 0;
  
  for (const check of checks) {
    if (check.relevant) {
      relevantCount++;
      // Precision at position k = relevant_up_to_k / k
      const precisionAtK = relevantCount / check.position;
      weightedSum += precisionAtK;
      
      hits.push(`Position ${check.position}: Relevant - ${check.reasoning}`);
    } else {
      misses.push(`Position ${check.position}: Not relevant - ${check.reasoning}`);
    }
  }
  
  // Final score = average precision across relevant items
  const totalRelevant = checks.filter(c => c.relevant).length;
  const score = totalRelevant > 0 ? weightedSum / totalRelevant : 0;
  
  return { score, hits, misses };
}
```

**Benefits:**
- ✅ Follows "plugin extensibility" principle
- ✅ Demonstrates advanced code_judge usage
- ✅ No core maintenance burden
- ✅ Users can customize for their needs
- ✅ Provides complete working example

**Drawbacks:**
- Users must copy/adapt the code (not a built-in command)
- Requires understanding of TypeScript (can also provide Python version)

---

### Option 2: Built-in Evaluator Type (NOT RECOMMENDED)

Add `contextual_precision` as a new built-in evaluator type.

**Why Not Recommended:**
1. **Violates "Lightweight Core" principle** - Niche use case should not bloat core
2. **Maintenance burden** - Core team must maintain RAG-specific logic
3. **Complexity creep** - Opens door to other domain-specific evaluators
4. **Not a primitive** - Can be composed from existing tools

**If implemented, would require:**
- New evaluator class in `packages/core/src/evaluation/evaluators.ts`
- Schema updates in `packages/core/src/evaluation/types.ts`
- Parser updates in `packages/core/src/evaluation/loaders/evaluator-parser.ts`
- Documentation in skill files
- Ongoing maintenance for edge cases

---

### Option 3: AgentV Skill / Recipe (ALTERNATIVE)

Create a Claude Code skill that teaches AI agents how to implement contextual precision evaluations.

**Location:** `apps/cli/src/templates/.claude/skills/contextual-precision-eval/`

**Why This Could Work:**
- Aligns with "AI-First Design" principle
- Teaches agents how to build RAG evaluations
- No code to maintain, just instructional content
- Flexible - agents adapt approach to user needs

**Skill Contents:**
```markdown
# Contextual Precision Evaluation Skill

This skill teaches you how to evaluate RAG retrieval quality using contextual precision.

## What is Contextual Precision?
[Explanation of metric]

## When to Use
- Evaluating retrieval systems
- Optimizing RAG pipelines
- Comparing retriever algorithms

## Implementation Approach
1. Use `code_judge` evaluator type
2. Parse retrieved context from candidate answer
3. Call LLM judge to evaluate each chunk's relevance
4. Calculate weighted precision score

## Example Implementation
[Code template]

## Common Patterns
[Tips and best practices]
```

**Benefits:**
- ✅ Zero maintenance (no code)
- ✅ AI-first approach
- ✅ Flexible to user needs

**Drawbacks:**
- ❌ Less concrete than working example
- ❌ Requires agent to implement correctly

---

## Comparison with Peer Frameworks

### DeepEval
```python
from deepeval.metrics import ContextualPrecisionMetric

metric = ContextualPrecisionMetric()
metric.measure(
    input="What is the capital of France?",
    expected_output="Paris",
    retrieval_context=["Paris is capital of France", "France is in Europe"]
)
```

**Analysis:**
- Built-in metric class
- Opinionated LLM provider (GPT-4)
- Simple API but less flexible

### Ragas
```python
from ragas.metrics import context_precision

score = context_precision.score({
    'question': 'What is the capital of France?',
    'contexts': ['Paris is capital...', 'France is in Europe...'],
    'answer': 'Paris'
})
```

**Analysis:**
- Functional API
- Requires specific input format
- Part of larger RAG evaluation suite

### AgentV Approach (Proposed)

```yaml
execution:
  evaluators:
    - name: retrieval_ranking
      type: code_judge
      script: npx --yes tsx ./evaluators/contextual-precision.ts
```

**Analysis:**
- Plugin-based (not built-in)
- Flexible implementation
- Users can customize logic
- Consistent with AgentV philosophy

---

## Related RAG Metrics (Future Considerations)

If contextual precision is added, users may also expect:

| Metric | Purpose | Implementation |
|--------|---------|----------------|
| **Contextual Recall** | Do retrieved chunks contain all necessary info? | Similar code_judge approach |
| **Contextual Relevance** | Are retrieved chunks relevant (no position weighting)? | Simpler version of precision |
| **Answer Relevance** | Does generated answer address the query? | Already possible with llm_judge |
| **Faithfulness** | Is answer grounded in retrieved context? | Code_judge checking citations |

**Recommendation:** If demand grows, create `examples/showcase/rag-evaluation/` with **all common RAG metrics** as reference implementations. This avoids adding 5+ built-in evaluator types.

---

## Implementation Recommendation

### Phase 1: Example Implementation (Immediate)

**Location:** `examples/showcase/rag-evaluation/`

**Contents:**
1. **Working code evaluator** (TypeScript + Python versions)
2. **Example eval file** with realistic RAG scenarios
3. **Mock RAG provider** for testing
4. **Comprehensive README** explaining:
   - What contextual precision measures
   - When to use it
   - How to customize for your RAG system
   - How to extend to other RAG metrics

**Effort Estimate:** 4-6 hours
- 2 hours: TypeScript implementation
- 1 hour: Python equivalent
- 1 hour: Example eval files
- 1 hour: Documentation
- 1 hour: Testing

### Phase 2: Documentation Update (If needed)

If user demand is high, add to skill references:

**File:** `apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/rag-evaluation.md`

**Contents:**
- Overview of RAG evaluation patterns
- Reference to contextual precision example
- Guide on implementing other RAG metrics
- Links to industry resources (DeepEval, Ragas docs)

**Effort Estimate:** 2 hours

### Phase 3: Monitor Demand (Ongoing)

Track adoption metrics:
- GitHub issues requesting built-in RAG metrics
- Community discussions about retrieval evaluation
- Example code usage/stars

**Decision Point:** If >50% of users need RAG evaluation, consider promoting common patterns to built-ins. Until then, keep as examples.

---

## Technical Implementation Details

### Input Schema for Contextual Precision Evaluator

```typescript
interface ContextualPrecisionInput {
  question: string;                    // User query
  candidateAnswer: string;             // Retrieved context (JSON or text)
  expectedOutcome: string;             // What good retrieval looks like
  
  // Optional fields
  retrievalContext?: string[];         // Explicit context array
  expectedRelevantCount?: number;      // Expected # of relevant chunks
  strictMode?: boolean;                // Fail if any irrelevant chunks present
}
```

### Output Schema

```typescript
interface ContextualPrecisionResult {
  score: number;                       // 0.0-1.0
  hits: string[];                      // "Position 1: Relevant - ..."
  misses: string[];                    // "Position 3: Not relevant - ..."
  reasoning: string;                   // Summary of evaluation
  
  // Optional metadata
  relevanceChecks?: {
    position: number;
    relevant: boolean;
    reasoning: string;
  }[];
}
```

### LLM Judge Configuration

For relevance checks, use:
- **Model:** `gpt-4o-mini` (fast, cheap, sufficient for binary relevance)
- **Temperature:** 0.1 (low for consistent judgments)
- **Prompt:** Simple yes/no relevance question with reasoning

**Example Prompt:**
```
Query: [user question]
Context: [chunk text]

Is this context relevant to answering the query?
Answer with JSON: {"relevant": true/false, "reasoning": "explanation"}
```

### Edge Cases to Handle

1. **Empty retrieved context** → score: 0, miss: "No context retrieved"
2. **Malformed JSON** → Attempt text parsing fallback
3. **LLM API failures** → Retry with exponential backoff (3 attempts)
4. **All irrelevant chunks** → score: 0, list all as misses
5. **All relevant chunks** → score: 1.0, perfect ranking

---

## Testing Strategy

### Unit Tests
```typescript
describe('contextual-precision', () => {
  it('should score 1.0 for perfect ranking', () => {
    // All relevant chunks, no irrelevant
  });
  
  it('should score < 1.0 when irrelevant chunks present', () => {
    // Mix of relevant and irrelevant
  });
  
  it('should score 0.0 when no relevant chunks', () => {
    // All irrelevant
  });
  
  it('should handle empty context gracefully', () => {
    // No chunks retrieved
  });
});
```

### Integration Tests
Run against mock RAG provider with known outputs:
```yaml
evalcases:
  - id: perfect-retrieval
    # Expected score: 1.0
    
  - id: poor-retrieval
    # Expected score: < 0.3
    
  - id: good-retrieval
    # Expected score: 0.7-0.9
```

---

## Documentation Plan

### README.md (in examples/showcase/rag-evaluation/)

```markdown
# RAG Evaluation Examples

Examples demonstrating how to evaluate Retrieval-Augmented Generation (RAG) systems with AgentV.

## Metrics Included

### 1. Contextual Precision
Measures retrieval ranking quality - are the most relevant chunks ranked first?

**Use when:**
- Optimizing retrieval algorithms
- Comparing different embedding models
- Evaluating reranking strategies

**Implementation:** `evaluators/contextual-precision.ts`

[Usage example]

### 2. Contextual Recall (TODO)
[Future metric]

### 3. Faithfulness (TODO)
[Future metric]

## Running Examples

```bash
cd examples/showcase/rag-evaluation
agentv run evals/retrieval-quality.yaml
```

## Customization Guide

[How to adapt for your RAG system]

## References

- [Confident AI - Contextual Precision](https://www.confident-ai.com/docs/metrics/single-turn/contextual-precision-metric)
- [DeepEval - RAG Metrics](https://docs.deepeval.com/metrics-contextual-precision)
- [Ragas - Context Precision](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_precision/)
```

---

## Conclusion

**Recommended Path Forward:**

1. ✅ **Implement as example code evaluator** in `examples/showcase/rag-evaluation/`
   - Follows AgentV design principles (plugin extensibility)
   - Provides working reference implementation
   - Low maintenance burden
   - Users can customize for their needs

2. ❌ **Do NOT add as built-in evaluator type**
   - Violates "lightweight core" principle
   - Niche use case (RAG-specific)
   - Can be composed from existing primitives
   - Would set precedent for other domain-specific evaluators

3. 🔮 **Future consideration:** If RAG evaluation demand grows significantly (>50% of users), consider:
   - Moving to built-in with other RAG metrics as suite
   - Creating dedicated `@agentv/rag` extension package
   - Adding skill file for AI-assisted RAG evaluation

**Implementation Priority:** Low-Medium
- Not blocking any core functionality
- Nice-to-have for RAG use cases
- Can be built by community as well

**Estimated Effort:** 4-6 hours for complete example implementation

---

## References

1. [Confident AI - Contextual Precision Documentation](https://www.confident-ai.com/docs/metrics/single-turn/contextual-precision-metric)
2. [DeepEval - Contextual Precision Metric](https://deepeval.com/docs/metrics-contextual-precision)
3. [Ragas - Context Precision](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/context_precision/)
4. [AgentV Repository Guidelines](../AGENTS.md)
5. [AgentV Custom Evaluators Guide](../apps/cli/src/templates/.claude/skills/agentv-eval-builder/references/custom-evaluators.md)
