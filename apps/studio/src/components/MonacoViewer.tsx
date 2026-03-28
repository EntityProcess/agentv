/**
 * Read-only Monaco Editor wrapper for displaying code, JSON, or text.
 *
 * Lazy-loads @monaco-editor/react to keep the initial bundle small.
 */

import { Suspense, lazy } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface MonacoViewerProps {
  value: string;
  language?: string;
  height?: string;
}

export function MonacoViewer({ value, language = 'json', height = '400px' }: MonacoViewerProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center rounded-lg bg-gray-900 p-8 text-gray-500">
          Loading editor...
        </div>
      }
    >
      <MonacoEditor
        height={height}
        language={language}
        value={value}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on',
          padding: { top: 12 },
        }}
      />
    </Suspense>
  );
}
