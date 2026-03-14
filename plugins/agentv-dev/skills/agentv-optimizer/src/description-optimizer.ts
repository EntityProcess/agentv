export interface DescriptionObservations {
  triggerMisses?: string[];
  falseTriggers?: string[];
}

export interface DescriptionExperiment {
  prompt: string;
  expectedOutcome: string;
}

export interface DescriptionImprovementPlan {
  nextExperiments: DescriptionExperiment[];
  diffPreview: string;
  summary: string;
}

/**
 * Build a provider-agnostic plan for improving skill descriptions
 * based on observed trigger misses and false triggers.
 */
export function buildDescriptionImprovementPlan(
  observations: DescriptionObservations,
): DescriptionImprovementPlan {
  const nextExperiments: DescriptionExperiment[] = [];

  // Generate experiments for trigger misses
  if (observations.triggerMisses && observations.triggerMisses.length > 0) {
    for (const missedPrompt of observations.triggerMisses) {
      nextExperiments.push({
        prompt: missedPrompt,
        expectedOutcome: 'skill should trigger and handle this request',
      });
    }
  }

  // Generate experiments for false triggers
  if (observations.falseTriggers && observations.falseTriggers.length > 0) {
    for (const falsePrompt of observations.falseTriggers) {
      nextExperiments.push({
        prompt: falsePrompt,
        expectedOutcome: 'skill should NOT trigger for this request',
      });
    }
  }

  // Build a diff preview showing suggested description changes
  const diffPreview = buildDiffPreview(observations);

  // Generate summary
  const summary = buildSummary(observations, nextExperiments.length);

  return {
    nextExperiments,
    diffPreview,
    summary,
  };
}

function buildDiffPreview(observations: DescriptionObservations): string {
  const lines: string[] = [];

  lines.push('--- SKILL.md');
  lines.push('+++ SKILL.md');
  lines.push('@@ -1,3 +1,5 @@');

  if (observations.triggerMisses && observations.triggerMisses.length > 0) {
    lines.push(' ## Description');
    lines.push('+');
    lines.push(`+ Add trigger patterns for: ${observations.triggerMisses.join(', ')}`);
  }

  if (observations.falseTriggers && observations.falseTriggers.length > 0) {
    lines.push(' ## Triggers');
    lines.push('+');
    lines.push(`+ Exclude false triggers: ${observations.falseTriggers.join(', ')}`);
  }

  return lines.join('\n');
}

function buildSummary(observations: DescriptionObservations, experimentCount: number): string {
  const parts: string[] = [];

  if (observations.triggerMisses && observations.triggerMisses.length > 0) {
    parts.push(`${observations.triggerMisses.length} trigger miss(es)`);
  }

  if (observations.falseTriggers && observations.falseTriggers.length > 0) {
    parts.push(`${observations.falseTriggers.length} false trigger(s)`);
  }

  if (parts.length === 0) {
    return `No observations found → Generated ${experimentCount} validation experiment(s)`;
  }

  return `Found ${parts.join(' and ')} → Generated ${experimentCount} validation experiment(s)`;
}
