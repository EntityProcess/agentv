import path from 'node:path';
import JSON5 from 'json5';

/**
 * Workspace folder configuration from VS Code workspace file
 */
export interface WorkspaceFolder {
  path: string;
  name?: string;
}

/**
 * VS Code workspace file structure
 */
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

/**
 * Transforms workspace template content by:
 * 1. Resolving all relative folder paths (including ".") to absolute paths based on templateDir
 * 2. Inserting { "path": "." } as the first folder entry (which will resolve to subagent dir)
 * 3. Resolving relative paths in chat settings (promptFilesLocations, instructionsFilesLocations, modeFilesLocations)
 *
 * @param workspaceContent - JSON string content of the workspace file
 * @param templateDir - Absolute path to the directory containing the template file
 * @returns Transformed workspace JSON string with proper formatting
 * @throws Error if JSON is invalid or folders array is missing
 */
export function transformWorkspacePaths(workspaceContent: string, templateDir: string): string {
  let workspace: WorkspaceConfig;

  try {
    // Use JSON5 to parse VS Code workspace files (supports trailing commas, comments, etc.)
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

  // Transform all existing folders by resolving relative paths to absolute
  const transformedFolders = workspace.folders.map((folder) => {
    const folderPath = folder.path;

    // Check if path is already absolute
    if (path.isAbsolute(folderPath)) {
      return folder;
    }

    // Resolve relative path (including ".") to absolute based on template directory
    const absolutePath = path.resolve(templateDir, folderPath);

    return {
      ...folder,
      path: absolutePath,
    };
  });

  // Insert { "path": "." } as the first entry (will resolve to subagent directory)
  const updatedFolders = [{ path: '.' }, ...transformedFolders];

  // Transform chat settings paths if they exist
  let transformedSettings = workspace.settings;
  if (workspace.settings) {
    transformedSettings = {
      ...workspace.settings,
    };

    // Transform each chat settings location object
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
          // Check if path is already absolute
          const isAbsolute = path.isAbsolute(locationPath);

          if (isAbsolute) {
            // Keep absolute paths as-is
            transformedMap[locationPath] = value as boolean;
          } else {
            // Split the path at the first glob character to separate base path from pattern
            const firstGlobIndex = locationPath.search(/[*]/);

            if (firstGlobIndex === -1) {
              // No glob pattern, just resolve the entire path
              const resolvedPath = path.resolve(templateDir, locationPath).replace(/\\/g, '/');
              transformedMap[resolvedPath] = value as boolean;
            } else {
              // Find the last path separator before the glob pattern
              const basePathEnd = locationPath.lastIndexOf('/', firstGlobIndex);
              const basePath = basePathEnd !== -1 ? locationPath.substring(0, basePathEnd) : '.';
              const patternPath = locationPath.substring(basePathEnd !== -1 ? basePathEnd : 0);

              // Resolve base path and append the pattern part (which includes the separator)
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

  // Create the transformed workspace configuration
  const transformedWorkspace: WorkspaceConfig = {
    ...workspace,
    folders: updatedFolders,
    settings: transformedSettings,
  };

  // Return formatted JSON with 2-space indentation
  return JSON.stringify(transformedWorkspace, null, 2);
}
