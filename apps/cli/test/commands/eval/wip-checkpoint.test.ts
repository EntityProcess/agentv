import { afterEach, describe, expect, it, mock } from 'bun:test';

import { WipCheckpointLoop } from '../../../src/commands/eval/wip-checkpoint.js';

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const cleanupMock = mock(async () => {});
const deleteWipBranchMock = mock(async () => {});
let pushWipCheckpointImplementation = async () => true;
const pushWipCheckpointMock = mock(async () => pushWipCheckpointImplementation());

afterEach(() => {
  cleanupMock.mockClear();
  deleteWipBranchMock.mockClear();
  pushWipCheckpointMock.mockClear();
  pushWipCheckpointImplementation = async () => true;
});

describe('WipCheckpointLoop', () => {
  it('waits for an in-flight checkpoint before cleanup and remote branch deletion', async () => {
    const checkpoint = deferred<boolean>();
    pushWipCheckpointImplementation = async () => checkpoint.promise;

    const loop = new WipCheckpointLoop({
      config: {
        mode: 'github',
        repo: 'https://github.com/example/results.git',
        branch: 'main',
        path: '/tmp/results',
        auto_push: true,
        branch_prefix: 'agentv/results',
      },
      runDir: '/tmp/run-001',
      destinationPath: 'default/run-001',
      intervalMs: 1,
      dependencies: {
        buildWipBranchName: (runDir) => `agentv/wip/test/${runDir.split('/').pop()}`,
        deleteWipBranch: deleteWipBranchMock,
        pushWipCheckpoint: pushWipCheckpointMock,
        setupWipWorktree: mock(async ({ wipBranch }) => ({
          wipBranch,
          worktreeDir: '/tmp/wip-worktree',
          cloneDir: '/tmp/wip-clone',
          cleanup: cleanupMock,
        })),
      },
    });

    await loop.start();
    await waitFor(() => pushWipCheckpointMock.mock.calls.length === 1);

    const stopped = loop.stopAndDeleteWipBranch();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cleanupMock).not.toHaveBeenCalled();
    expect(deleteWipBranchMock).not.toHaveBeenCalled();

    checkpoint.resolve(true);
    await stopped;

    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(deleteWipBranchMock).toHaveBeenCalledTimes(1);
  });
});
