import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type ArtifactCatalogEntry,
  type FileNode,
  overlayCatalogFileNodes,
  shouldHydrateRunRecordsForList,
} from './serve.js';

/**
 * Reproduces the bug where git-stored `agentv/artifacts/v1` files were rendered
 * in a duplicate parallel subtree instead of overlaying onto the existing tree.
 *
 * The local file tree is rooted at the artifacts' common dir, so its top-level
 * nodes are named by basename (`outputs`) while their `path` stays relative to
 * the run manifest dir (`<suite>/<test>/outputs`). A git catalog entry whose
 * displayPath carries the full `<suite>/<test>/...` prefix must merge into that
 * existing `outputs` folder, not create a second `<suite>/<test>/outputs` tree.
 */
function localTreeRootedAtTestDir(prefix: string): FileNode[] {
  return [
    {
      name: 'outputs',
      path: `${prefix}/outputs`,
      type: 'dir',
      children: [
        { name: 'answer.md', path: `${prefix}/outputs/answer.md`, type: 'file', storage: 'local' },
      ],
    },
    { name: 'grading.json', path: `${prefix}/grading.json`, type: 'file', storage: 'local' },
  ];
}

function gitTranscriptEntry(prefix: string): ArtifactCatalogEntry {
  return {
    displayPath: `${prefix}/transcript.jsonl`,
    kind: 'transcript',
    storage: 'git',
    ref: 'agentv/artifacts/v1',
    key: `runs/2026-06-22T01-12-44-924Z/${prefix}/transcript.jsonl`,
  };
}

function findByName(nodes: readonly FileNode[], name: string): FileNode | undefined {
  return nodes.find((node) => node.name === name);
}

describe('overlayCatalogFileNodes', () => {
  const prefix = 'wtg-academy-n1-test/test-01-biosecurity';

  it('overlays git artifacts into the existing folder instead of a duplicate subtree', () => {
    const files = localTreeRootedAtTestDir(prefix);
    overlayCatalogFileNodes(files, [gitTranscriptEntry(prefix)], prefix);

    // No duplicate `wtg-academy-n1-test` root node was created.
    expect(findByName(files, 'wtg-academy-n1-test')).toBeUndefined();

    // transcript.jsonl merged into the existing top-level test artifact view
    // with its full manifest-relative path preserved for content reads.
    const transcript = findByName(files, 'transcript.jsonl');
    expect(transcript).toBeDefined();
    expect(transcript?.path).toBe(`${prefix}/transcript.jsonl`);
    expect(transcript?.storage).toBe('git');
    expect(transcript?.ref).toBe('agentv/artifacts/v1');
  });

  it('does not re-add local files already present in the tree', () => {
    const files = localTreeRootedAtTestDir(prefix);
    const localEntry: ArtifactCatalogEntry = {
      displayPath: `${prefix}/grading.json`,
      kind: 'artifact',
      storage: 'local',
      path: `${prefix}/grading.json`,
    };
    overlayCatalogFileNodes(files, [localEntry], prefix);

    expect(files.filter((node) => node.name === 'grading.json')).toHaveLength(1);
    expect(findByName(files, 'wtg-academy-n1-test')).toBeUndefined();
  });

  it('falls back to full-path nesting when no root prefix applies', () => {
    const files: FileNode[] = [];
    const entry: ArtifactCatalogEntry = {
      displayPath: 'outputs/transcript.jsonl',
      kind: 'transcript',
      storage: 'git',
      ref: 'agentv/artifacts/v1',
    };
    overlayCatalogFileNodes(files, [entry], undefined);

    const outputs = findByName(files, 'outputs');
    expect(outputs?.type).toBe('dir');
    expect(findByName(outputs?.children ?? [], 'transcript.jsonl')?.path).toBe(
      'outputs/transcript.jsonl',
    );
  });
});

describe('shouldHydrateRunRecordsForList', () => {
  it('skips remote-only runs so list pages do not materialize details', () => {
    expect(
      shouldHydrateRunRecordsForList({
        source: 'remote',
        path: path.join(os.tmpdir(), 'agentv-missing-remote-run', 'index.jsonl'),
      } as Parameters<typeof shouldHydrateRunRecordsForList>[0]),
    ).toBe(false);
  });

  it('hydrates local and already-materialized remote runs', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentv-run-list-hydrate-'));
    const manifestPath = path.join(tempDir, 'index.jsonl');
    writeFileSync(manifestPath, '', 'utf8');
    try {
      expect(existsSync(manifestPath)).toBe(true);
      expect(
        shouldHydrateRunRecordsForList({
          source: 'remote',
          path: manifestPath,
        } as Parameters<typeof shouldHydrateRunRecordsForList>[0]),
      ).toBe(true);
      expect(
        shouldHydrateRunRecordsForList({
          source: 'local',
          path: path.join(tempDir, 'missing-local-index.jsonl'),
        } as Parameters<typeof shouldHydrateRunRecordsForList>[0]),
      ).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
