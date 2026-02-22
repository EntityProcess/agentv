import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformWorkspacePaths } from '../../../../../src/evaluation/providers/vscode/utils/workspace.js';

describe('transformWorkspacePaths', () => {
  const templateDir = '/home/user/templates/project';

  // S8: relative paths are resolved to absolute
  it('resolves relative folder paths against templateDir', () => {
    const input = JSON.stringify({
      folders: [{ path: './src' }, { path: 'lib' }],
    });

    const result = JSON.parse(transformWorkspacePaths(input, templateDir));

    // First folder is always the prepended '.'
    expect(result.folders[0]).toEqual({ path: '.' });
    expect(result.folders[1]).toEqual({ path: path.resolve(templateDir, 'src') });
    expect(result.folders[2]).toEqual({ path: path.resolve(templateDir, 'lib') });
  });

  // S9: absolute paths are preserved
  it('preserves absolute folder paths', () => {
    const absPath = '/absolute/project';
    const input = JSON.stringify({
      folders: [{ path: absPath }],
    });

    const result = JSON.parse(transformWorkspacePaths(input, templateDir));

    expect(result.folders[0]).toEqual({ path: '.' });
    expect(result.folders[1]).toEqual({ path: absPath });
  });

  // S10: settings globs are resolved correctly
  it('resolves relative settings globs against templateDir', () => {
    const input = JSON.stringify({
      folders: [{ path: '.' }],
      settings: {
        'chat.promptFilesLocations': {
          'prompts/**/*.md': true,
          '/absolute/path': true,
        },
      },
    });

    const result = JSON.parse(transformWorkspacePaths(input, templateDir));

    const locations = result.settings['chat.promptFilesLocations'];
    // Relative glob should be resolved
    const resolvedGlob = `${path.resolve(templateDir, 'prompts')}/**/*.md`;
    expect(locations[resolvedGlob.replace(/\\/g, '/')]).toBe(true);
    // Absolute path should be preserved
    expect(locations['/absolute/path']).toBe(true);
  });

  // S11: cwd passthrough — transformWorkspacePaths doesn't handle cwd, that's copyAgentConfig's job
  it('does not add cwd — cwd injection is done by copyAgentConfig', () => {
    const input = JSON.stringify({
      folders: [{ path: './src' }],
    });

    const result = JSON.parse(transformWorkspacePaths(input, templateDir));

    // Only '.' (prepended) and the resolved src folder
    expect(result.folders.length).toBe(2);
  });
});
