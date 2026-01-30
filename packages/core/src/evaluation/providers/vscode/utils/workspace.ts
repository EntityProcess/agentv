import path from 'node:path';
import JSON5 from 'json5';

export interface WorkspaceFolder {
  path: string;
  name?: string;
}

export interface WorkspaceConfig {
  folders: WorkspaceFolder[];
  settings?: {
    'chat.promptFilesLocations'?: Record<string, boolean>;
    'chat.instructionsFilesLocations'?: Record<string, boolean>;
    'chat.modeFilesLocations'?: Record<string, boolean>;
    [key: string]: unknown;
  };
  extensions?: {
    recommendations?: string[];
  };
}

export function transformWorkspacePaths(workspaceContent: string, templateDir: string): string {
  let workspace: WorkspaceConfig;

  try {
    workspace = JSON5.parse(workspaceContent) as WorkspaceConfig;
  } catch (error) {
    throw new Error(`Invalid workspace JSON: ${(error as Error).message}`);
  }

  if (!workspace.folders) {
    throw new Error("Workspace file must contain a 'folders' array");
  }

  if (!Array.isArray(workspace.folders)) {
    throw new Error("Workspace 'folders' must be an array");
  }

  const transformedFolders = workspace.folders.map((folder) => {
    const folderPath = folder.path;

    if (path.isAbsolute(folderPath)) {
      return folder;
    }

    const absolutePath = path.resolve(templateDir, folderPath);

    return {
      ...folder,
      path: absolutePath,
    };
  });

  const updatedFolders = [{ path: '.' }, ...transformedFolders];

  let transformedSettings = workspace.settings;
  if (workspace.settings) {
    transformedSettings = {
      ...workspace.settings,
    };

    const chatSettingsKeys = [
      'chat.promptFilesLocations',
      'chat.instructionsFilesLocations',
      'chat.modeFilesLocations',
    ] as const;

    for (const settingKey of chatSettingsKeys) {
      const locationMap = workspace.settings[settingKey] as Record<string, boolean> | undefined;
      if (locationMap && typeof locationMap === 'object') {
        const transformedMap: Record<string, boolean> = {};

        for (const [locationPath, value] of Object.entries(locationMap)) {
          const isAbsolute = path.isAbsolute(locationPath);

          if (isAbsolute) {
            transformedMap[locationPath] = value as boolean;
          } else {
            const firstGlobIndex = locationPath.search(/[*]/);

            if (firstGlobIndex === -1) {
              const resolvedPath = path.resolve(templateDir, locationPath).replace(/\\/g, '/');
              transformedMap[resolvedPath] = value as boolean;
            } else {
              const basePathEnd = locationPath.lastIndexOf('/', firstGlobIndex);
              const basePath = basePathEnd !== -1 ? locationPath.substring(0, basePathEnd) : '.';
              const patternPath = locationPath.substring(basePathEnd !== -1 ? basePathEnd : 0);

              const resolvedPath = (path.resolve(templateDir, basePath) + patternPath).replace(
                /\\/g,
                '/',
              );
              transformedMap[resolvedPath] = value as boolean;
            }
          }
        }

        transformedSettings[settingKey] = transformedMap;
      }
    }
  }

  const transformedWorkspace: WorkspaceConfig = {
    ...workspace,
    folders: updatedFolders,
    settings: transformedSettings,
  };

  return JSON.stringify(transformedWorkspace, null, 2);
}
