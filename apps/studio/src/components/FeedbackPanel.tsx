/**
 * Feedback panel for leaving review comments on individual eval results.
 *
 * Reads existing feedback via the /api/feedback endpoint and persists
 * new comments via POST /api/feedback.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { useFeedback } from '~/lib/api';

interface FeedbackPanelProps {
  testId: string;
}

async function saveFeedback(testId: string, comment: string) {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviews: [{ test_id: testId, comment }] }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save feedback: ${res.status}`);
  }
  return res.json();
}

export function FeedbackPanel({ testId }: FeedbackPanelProps) {
  const { data } = useFeedback();
  const queryClient = useQueryClient();

  const existing = data?.reviews?.find((r) => r.test_id === testId);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [saved, setSaved] = useState(false);

  // Sync when feedback data loads (existing?.comment captures testId changes
  // since `existing` is derived from testId via the find() above)
  useEffect(() => {
    setComment(existing?.comment ?? '');
    setSaved(false);
  }, [existing?.comment]);

  const mutation = useMutation({
    mutationFn: () => saveFeedback(testId, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = useCallback(() => {
    mutation.mutate();
  }, [mutation]);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h4 className="mb-2 text-sm font-medium text-gray-400">Feedback</h4>
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          setSaved(false);
        }}
        placeholder="Add feedback for this test..."
        className="w-full rounded-md border border-gray-700 bg-gray-800 p-3 text-sm text-gray-200 placeholder-gray-500 focus:border-cyan-400 focus:outline-none"
        rows={3}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={mutation.isPending}
          className="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving...' : 'Save Feedback'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved</span>}
        {mutation.isError && <span className="text-sm text-red-400">Error saving feedback</span>}
      </div>
    </div>
  );
}
