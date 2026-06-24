import { describe, expect, it } from 'bun:test';

import { type ArtifactCatalogEntry, type FileNode, overlayCatalogFileNodes } from './serve.js';

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

function gitTraceEntry(prefix: string): ArtifactCatalogEntry {
  return {
    displayPath: `${prefix}/outputs/trace.json`,
    kind: 'trace',
    storage: 'git',
    ref: 'agentv/artifacts/v1',
    key: `runs/default/2026-06-22T01-12-44-924Z/${prefix}/outputs/trace.json`,
  };
}

function findByName(nodes: readonly FileNode[], name: string): FileNode | undefined {
  return nodes.find((node) => node.name === name);
}

describe('overlayCatalogFileNodes', () => {
  const prefix = 'wtg-academy-n1-test/test-01-biosecurity';

  it('overlays git artifacts into the existing folder instead of a duplicate subtree', () => {
    const files = localTreeRootedAtTestDir(prefix);
    overlayCatalogFileNodes(files, [gitTraceEntry(prefix)], prefix);

    // No duplicate `wtg-academy-n1-test` root node was created.
    expect(findByName(files, 'wtg-academy-n1-test')).toBeUndefined();

    // trace.json merged into the existing top-level `outputs` folder...
    const outputs = findByName(files, 'outputs');
    expect(outputs?.type).toBe('dir');
    const trace = findByName(outputs?.children ?? [], 'trace.json');
    expect(trace).toBeDefined();
    // ...alongside the local answer.md, and with its full manifest-relative path
    // preserved for content reads.
    expect(findByName(outputs?.children ?? [], 'answer.md')).toBeDefined();
    expect(trace?.path).toBe(`${prefix}/outputs/trace.json`);
    expect(trace?.storage).toBe('git');
    expect(trace?.ref).toBe('agentv/artifacts/v1');
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
      displayPath: 'outputs/trace.json',
      kind: 'trace',
      storage: 'git',
      ref: 'agentv/artifacts/v1',
    };
    overlayCatalogFileNodes(files, [entry], undefined);

    const outputs = findByName(files, 'outputs');
    expect(outputs?.type).toBe('dir');
    expect(findByName(outputs?.children ?? [], 'trace.json')?.path).toBe('outputs/trace.json');
  });
});
