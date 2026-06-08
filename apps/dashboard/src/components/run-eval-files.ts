import type { DiscoveredEvalFile } from '~/lib/types';

export interface EvalFileOption {
  path: string;
  relativePath: string;
  category: string;
}

export function toEvalFileOptions(evalFiles: DiscoveredEvalFile[]): EvalFileOption[] {
  return evalFiles.map((file) => ({
    path: file.path,
    relativePath: file.relative_path,
    category: file.category,
  }));
}

export function getSuiteFilterSearchTerm(suiteFilter: string): string {
  const parts = suiteFilter.split(',');
  return (parts.at(-1) ?? '').trim();
}

export function filterEvalFileOptions(
  evalFiles: EvalFileOption[],
  suiteFilter: string,
): EvalFileOption[] {
  const term = getSuiteFilterSearchTerm(suiteFilter).toLowerCase();

  if (!term) {
    return evalFiles;
  }

  return evalFiles.filter((file) => {
    return (
      file.relativePath.toLowerCase().includes(term) || file.category.toLowerCase().includes(term)
    );
  });
}

export function selectEvalFileForSuiteFilter(suiteFilter: string, relativePath: string): string {
  const parts = suiteFilter.split(',');
  const hasOpenSlot = /,\s*$/.test(suiteFilter);
  const keptParts = hasOpenSlot ? parts : parts.slice(0, -1);
  const selected = keptParts.map((part) => part.trim()).filter(Boolean);
  const deduped = selected.filter((part) => part !== relativePath);

  return [...deduped, relativePath].join(', ');
}
