import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CompareResponse } from '~/lib/types';

import { AnalyticsTab } from './AnalyticsTab';

function compareResponse(): CompareResponse {
  return {
    experiments: ['model-compare'],
    targets: ['gpt-5.4', 'gpt-5.4-mini'],
    cells: [
      {
        experiment: 'model-compare',
        target: 'gpt-5.4',
        eval_count: 1,
        quality_count: 1,
        passed_count: 1,
        pass_rate: 1,
        avg_score: 1,
        tests: [
          {
            test_id: 'exact-token',
            target: 'gpt-5.4',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'AV94NI_OK',
          },
        ],
      },
      {
        experiment: 'model-compare',
        target: 'gpt-5.4-mini',
        eval_count: 1,
        quality_count: 1,
        passed_count: 1,
        pass_rate: 1,
        avg_score: 1,
        tests: [
          {
            test_id: 'exact-token',
            target: 'gpt-5.4-mini',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'AV94NI_OK',
          },
        ],
      },
    ],
    runs: [
      {
        run_id: '2026-07-07T14-06-40-813Z',
        started_at: '2026-07-07T14:06:40.813Z',
        experiment: 'model-compare',
        target: '2 providers',
        targets: ['gpt-5.4', 'gpt-5.4-mini'],
        source: 'local',
        eval_count: 2,
        quality_count: 2,
        passed_count: 2,
        pass_rate: 1,
        avg_score: 1,
        tests: [
          {
            test_id: 'exact-token',
            target: 'gpt-5.4',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'AV94NI_OK from gpt-5.4',
            answer_path: 'exact-token-gpt54/sample-1/outputs/answer.md',
            grading_path: 'exact-token-gpt54/sample-1/grading.json',
            result_dir: 'exact-token-gpt54',
            duration_ms: 1234,
          },
          {
            test_id: 'exact-token',
            target: 'gpt-5.4-mini',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'AV94NI_OK from gpt-5.4-mini',
            answer_path: 'exact-token-mini/sample-1/outputs/answer.md',
            result_dir: 'exact-token-mini',
            duration_ms: 987,
          },
        ],
      },
    ],
  };
}

function differingCompareResponse(): CompareResponse {
  return {
    experiments: ['model-compare'],
    targets: ['gpt-5.4', 'gpt-5.4-mini'],
    cells: [
      {
        experiment: 'model-compare',
        target: 'gpt-5.4',
        eval_count: 2,
        quality_count: 2,
        passed_count: 1,
        pass_rate: 0.5,
        avg_score: 0.5,
        tests: [],
      },
      {
        experiment: 'model-compare',
        target: 'gpt-5.4-mini',
        eval_count: 2,
        quality_count: 2,
        passed_count: 2,
        pass_rate: 1,
        avg_score: 1,
        tests: [],
      },
    ],
    runs: [
      {
        run_id: '2026-07-07T14-06-40-813Z',
        started_at: '2026-07-07T14:06:40.813Z',
        experiment: 'model-compare',
        target: '2 providers',
        targets: ['gpt-5.4', 'gpt-5.4-mini'],
        source: 'local',
        eval_count: 4,
        quality_count: 4,
        passed_count: 3,
        pass_rate: 0.75,
        avg_score: 0.75,
        tests: [
          {
            test_id: 'matching-row',
            target: 'gpt-5.4',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'same answer',
          },
          {
            test_id: 'matching-row',
            target: 'gpt-5.4-mini',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'same answer',
          },
          {
            test_id: 'answer-differs',
            target: 'gpt-5.4',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'alpha answer',
          },
          {
            test_id: 'answer-differs',
            target: 'gpt-5.4-mini',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'beta answer',
          },
          {
            test_id: 'status-differs',
            target: 'gpt-5.4',
            score: 1,
            passed: true,
            execution_status: 'ok',
            answer: 'completed',
          },
          {
            test_id: 'status-differs',
            target: 'gpt-5.4-mini',
            score: 0,
            passed: false,
            execution_status: 'execution_error',
            answer: 'completed',
          },
        ],
      },
    ],
  };
}

function matchingCompareResponse(): CompareResponse {
  const data = differingCompareResponse();
  return {
    ...data,
    runs: data.runs?.map((run) => ({
      ...run,
      tests: [
        {
          test_id: 'matching-row',
          target: 'gpt-5.4',
          score: 1,
          passed: true,
          execution_status: 'ok',
          answer: 'same answer',
        },
        {
          test_id: 'matching-row',
          target: 'gpt-5.4-mini',
          score: 1,
          passed: true,
          execution_status: 'ok',
          answer: 'same answer',
        },
      ],
    })),
  };
}

describe('AnalyticsTab provider/model comparison', () => {
  it('renders same-test provider/model outputs side by side', () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AnalyticsTab data={compareResponse()} isLoading={false} isError={false} />
      </QueryClientProvider>,
    );

    expect(html).toContain('Provider/model comparison');
    expect(html).toContain('Provider/Model');
    expect(html).toContain('exact-token');
    expect(html).toContain('gpt-5.4');
    expect(html).toContain('gpt-5.4-mini');
    expect(html).toContain('AV94NI_OK from gpt-5.4');
    expect(html).toContain('AV94NI_OK from gpt-5.4-mini');
    expect(html).toContain('Answer');
    expect(html).toContain('result_dir=exact-token-gpt54');
  });

  it('filters provider/model comparison rows to differing outputs', () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AnalyticsTab
          data={differingCompareResponse()}
          isLoading={false}
          isError={false}
          defaultProviderModelDisplayMode="differing"
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('All');
    expect(html).toContain('Differing');
    expect(html).toContain('answer-differs');
    expect(html).toContain('alpha answer');
    expect(html).toContain('beta answer');
    expect(html).toContain('status-differs');
    expect(html).toContain('error');
    expect(html).not.toContain('matching-row');
  });

  it('shows an empty state when all provider/model comparison rows match', () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AnalyticsTab
          data={matchingCompareResponse()}
          isLoading={false}
          isError={false}
          defaultProviderModelDisplayMode="differing"
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('All compared rows match');
    expect(html).toContain('Switch back to All rows to inspect the full provider/model table.');
    expect(html).not.toContain('matching-row');
  });
});
