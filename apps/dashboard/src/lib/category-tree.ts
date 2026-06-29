import { summarizeQuality } from './result-summary';
import type { EvalResult } from './types';

export const DEFAULT_CATEGORY = 'Uncategorized';

export interface CategoryTreeNode {
  name: string;
  label: string;
  parent?: string;
  depth: number;
  total: number;
  passed: number;
  failed: number;
  executionErrors: number;
  avgScore: number;
  suiteCount: number;
  childCount: number;
  children: CategoryTreeNode[];
}

interface CategoryBucket {
  results: EvalResult[];
  suites: Set<string>;
  children: Set<string>;
}

export function normalizeCategoryPath(category: string | undefined): string {
  const normalized = category
    ?.replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('/');
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CATEGORY;
}

export function buildCategoryTree(
  results: readonly EvalResult[],
  passThreshold: number,
): CategoryTreeNode[] {
  const buckets = new Map<string, CategoryBucket>();
  const ensureBucket = (name: string): CategoryBucket => {
    const existing = buckets.get(name);
    if (existing) return existing;
    const created = { results: [], suites: new Set<string>(), children: new Set<string>() };
    buckets.set(name, created);
    return created;
  };

  for (const result of results) {
    const category = normalizeCategoryPath(result.category);
    const suite = result.suite ?? 'Uncategorized';
    const prefixes = categoryPrefixes(category);
    for (const prefix of prefixes) {
      const bucket = ensureBucket(prefix);
      bucket.results.push(result);
      bucket.suites.add(suite);
    }
    for (let index = 1; index < prefixes.length; index++) {
      ensureBucket(prefixes[index - 1]).children.add(prefixes[index]);
    }
  }

  const nodeByName = new Map(
    [...buckets.entries()].map(([name, bucket]) => [
      name,
      summarizeCategoryBucket(name, bucket, passThreshold),
    ]),
  );

  return [...nodeByName.values()]
    .filter((node) => !node.parent)
    .sort(compareCategoryNodes)
    .map((node) => attachChildren(node, buckets, nodeByName));
}

export function flattenCategoryTree(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

function categoryPrefixes(category: string): string[] {
  const parts = category.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return [DEFAULT_CATEGORY];
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function categoryParent(category: string): string | undefined {
  const parts = category.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
}

function categoryLabel(category: string): string {
  return category.split('/').at(-1) ?? category;
}

function summarizeCategoryBucket(
  name: string,
  bucket: CategoryBucket,
  passThreshold: number,
): CategoryTreeNode {
  const summary = summarizeQuality(bucket.results, passThreshold);
  const parent = categoryParent(name);
  return {
    name,
    label: categoryLabel(name),
    ...(parent && { parent }),
    depth: name.split('/').filter(Boolean).length - 1,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    executionErrors: summary.executionErrors,
    avgScore: summary.avgScore,
    suiteCount: bucket.suites.size,
    childCount: bucket.children.size,
    children: [],
  };
}

function attachChildren(
  node: CategoryTreeNode,
  buckets: Map<string, CategoryBucket>,
  nodeByName: Map<string, CategoryTreeNode>,
): CategoryTreeNode {
  const children = [...(buckets.get(node.name)?.children ?? [])]
    .map((childName) => nodeByName.get(childName))
    .filter((child): child is CategoryTreeNode => Boolean(child))
    .sort(compareCategoryNodes)
    .map((child) => attachChildren(child, buckets, nodeByName));
  return { ...node, children };
}

function compareCategoryNodes(first: CategoryTreeNode, second: CategoryTreeNode): number {
  return first.name.localeCompare(second.name);
}
