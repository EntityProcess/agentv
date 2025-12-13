# Mental Health Framework Showcase

This showcase demonstrates AI-powered therapeutic framework routing and application using AgentV evaluation framework.

## Overview

The mental health showcase includes two therapeutic frameworks and one router:
- **Three Levels of Listening** (`listening.md`) - Analyzes client statements across Content, Emotion, and Process levels
- **Resource-Focused Encouragement** (`encouragement.md`) - Shifts perspective from deficit to resource using One-Key Three-Links approach
- **Framework Router** (`routing.md`) - Intelligently routes client statements to the most appropriate therapeutic framework

## Evaluation Datasets

### dataset-routing.yaml
Tests the router's ability to select the appropriate framework for different client statements.

**Known Baseline Issues:**
- `route-to-listening-gatekeeper` deliberately scores low (0.5) due to ambiguous routing guidelines. This case involves triangulation - a dysfunctional family pattern where the client mediates between wife and mother. The AI incorrectly selects `resource_focused_encouragement` because the surface indicators (exhaustion, protective behavior, stuckness) match the encouragement criteria. However, the correct choice is `three_levels_listening` because encouraging triangulation would reinforce pathological behavior. This case is left as a baseline to demonstrate the need for more nuanced routing guidelines that distinguish adaptive protective behaviors from dysfunctional patterns.

### dataset-encouragement.yaml
Tests the resource-focused encouragement framework's ability to identify resources and reframe client statements.

**Known Baseline Issues:**
- `encouragement-cutting-paradox` fails due to content being flagged as sensitive by the LLM provider's safety filters.

### dataset-listening.yaml
Tests the three levels of listening framework's ability to analyze client statements across Content, Emotion, and Process dimensions.

## Purpose

This dataset is used for experimenting with prompt optimization methods, including:
- Testing baseline performance before optimization
- Identifying edge cases that require guideline improvements
- Demonstrating how evaluation-driven development improves therapeutic AI systems
- Exploring how optimization techniques handle sensitive content and nuanced therapeutic decisions
