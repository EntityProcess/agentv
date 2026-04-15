import { describe, expect, it } from 'vitest';
import { RunBudgetTracker } from '../../src/evaluation/run-budget-tracker.js';

describe('RunBudgetTracker', () => {
  it('starts with zero cumulative cost', () => {
    const tracker = new RunBudgetTracker(10);
    expect(tracker.currentCostUsd).toBe(0);
    expect(tracker.budgetCapUsd).toBe(10);
    expect(tracker.isExceeded()).toBe(false);
  });

  it('accumulates cost and detects when budget is exceeded', () => {
    const tracker = new RunBudgetTracker(1.0);

    tracker.add(0.4);
    expect(tracker.currentCostUsd).toBe(0.4);
    expect(tracker.isExceeded()).toBe(false);

    tracker.add(0.5);
    expect(tracker.currentCostUsd).toBeCloseTo(0.9);
    expect(tracker.isExceeded()).toBe(false);

    tracker.add(0.2);
    expect(tracker.currentCostUsd).toBeCloseTo(1.1);
    expect(tracker.isExceeded()).toBe(true);
  });

  it('treats exact cap as exceeded', () => {
    const tracker = new RunBudgetTracker(1.0);
    tracker.add(1.0);
    expect(tracker.isExceeded()).toBe(true);
  });

  it('handles many small additions', () => {
    const tracker = new RunBudgetTracker(0.5);
    for (let i = 0; i < 100; i++) {
      tracker.add(0.001);
    }
    expect(tracker.currentCostUsd).toBeCloseTo(0.1);
    expect(tracker.isExceeded()).toBe(false);

    tracker.add(0.5);
    expect(tracker.isExceeded()).toBe(true);
  });

  it('never exceeds with zero-cost additions', () => {
    const tracker = new RunBudgetTracker(0.01);
    tracker.add(0);
    tracker.add(0);
    expect(tracker.isExceeded()).toBe(false);
  });
});
