/**
 * Collapsible file tree component for showing eval artifacts.
 *
 * Displays a hierarchical file/folder structure with extension-based icons,
 * collapsible directories, and selection highlighting.
 */

import { useState } from 'react';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return '\u{1F4D8}';
    case 'json':
      return '\u{1F4CB}';
    case 'log':
    case 'txt':
      return '\u{1F4DC}';
    case 'md':
      return '\u{1F4DD}';
    default:
      return '\u{1F4C4}';
  }
}

function collectAllDirs(nodes: FileNode[]): string[] {
  const dirs: string[] = [];
  for (const node of nodes) {
    if (node.type === 'dir') {
      dirs.push(node.path);
      if (node.children) {
        dirs.push(...collectAllDirs(node.children));
      }
    }
  }
  return dirs;
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  openFolders,
  toggleFolder,
  depth = 0,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  depth?: number;
}) {
  const isDir = node.type === 'dir';
  const isOpen = openFolders.has(node.path);
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) {
            toggleFolder(node.path);
          } else {
            onSelect(node.path);
          }
        }}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors ${
          isSelected
            ? 'bg-cyan-400/20 text-cyan-400'
            : 'text-gray-300 hover:bg-gray-800/50 hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="flex-shrink-0 text-xs">
          {isDir ? (isOpen ? '\u{1F4C2}' : '\u{1F4C1}') : getFileIcon(node.name)}
        </span>
        <span className="truncate">{node.name}</span>
      </button>

      {isDir && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              openFolders={openFolders}
              toggleFolder={toggleFolder}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    () => new Set<string>(collectAllDirs(files)),
  );

  const toggleFolder = (path: string) => {
    setOpenFolders((prev: Set<string>) => {
      const next = new Set<string>(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="w-64 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900 py-2">
      {files.length === 0 && <p className="px-4 py-2 text-sm text-gray-500">No files.</p>}
      {files.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          openFolders={openFolders}
          toggleFolder={toggleFolder}
        />
      ))}
    </div>
  );
}
