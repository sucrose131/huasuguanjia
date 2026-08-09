export type CategoryId = string | number | bigint;

export interface CategoryRecord {
  id: CategoryId;
  name?: string | null;
  parentId?: CategoryId | null;
  warehouseType?: string | number | null;
  status?: string | number | null;
  [key: string]: unknown;
}

export type CategoryTreeNode<T extends CategoryRecord = CategoryRecord> = T & {
  children: CategoryTreeNode<T>[];
  depth: number;
  hierarchyWarning?: string;
};

export interface CategoryTreeFilter {
  keyword?: unknown;
  parentId?: unknown;
  warehouseType?: unknown;
  status?: unknown;
}

const keyOf = (value: unknown) => String(value ?? '').trim();
const parentKeyOf = (value: unknown) => {
  const key = keyOf(value);
  return key === '0' ? '' : key;
};

function appendWarning(node: CategoryTreeNode, warning: string) {
  node.hierarchyWarning = node.hierarchyWarning
    ? `${node.hierarchyWarning}；${warning}`
    : warning;
}

function parentChainContains(
  startKey: string,
  targetKey: string,
  sourceById: Map<string, CategoryRecord>,
) {
  const visited = new Set<string>();
  let currentKey = startKey;
  while (currentKey && !visited.has(currentKey)) {
    if (currentKey === targetKey) return true;
    visited.add(currentKey);
    currentKey = parentKeyOf(sourceById.get(currentKey)?.parentId);
  }
  return false;
}

export function buildCategoryTree<T extends CategoryRecord>(items: T[]): CategoryTreeNode<T>[] {
  const nodesById = new Map<string, CategoryTreeNode<T>>();
  const sourceById = new Map<string, T>();
  const orderedKeys: string[] = [];

  for (const item of items) {
    const key = keyOf(item.id);
    if (!key) continue;
    const existing = nodesById.get(key);
    if (existing) {
      appendWarning(existing, `存在重复分类ID：${key}`);
      continue;
    }
    const name = String(item.name ?? '').trim() || `未命名分类 #${key}`;
    nodesById.set(key, { ...item, name, children: [], depth: 0 });
    sourceById.set(key, item);
    orderedKeys.push(key);
  }

  const roots: CategoryTreeNode<T>[] = [];
  for (const key of orderedKeys) {
    const node = nodesById.get(key)!;
    const parentKey = parentKeyOf(node.parentId);
    if (!parentKey) {
      roots.push(node);
      continue;
    }
    const parent = nodesById.get(parentKey);
    if (!parent) {
      appendWarning(node, `上级分类 ${parentKey} 不存在`);
      roots.push(node);
      continue;
    }
    if (parentKey === key || parentChainContains(parentKey, key, sourceById)) {
      appendWarning(node, '检测到循环层级，已临时作为顶级分类展示');
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const stack = roots.map((node) => ({ node, depth: 0 }));
  while (stack.length) {
    const current = stack.pop()!;
    current.node.depth = current.depth;
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: current.node.children[index]!, depth: current.depth + 1 });
    }
  }
  return roots;
}

export function flattenCategoryTree<T extends CategoryRecord>(
  roots: CategoryTreeNode<T>[],
): CategoryTreeNode<T>[] {
  const result: CategoryTreeNode<T>[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return result;
}

function cloneTree<T extends CategoryRecord>(
  roots: CategoryTreeNode<T>[],
  retained?: Set<string>,
): CategoryTreeNode<T>[] {
  return roots.flatMap((node) => {
    if (retained && !retained.has(keyOf(node.id))) return [];
    return [{ ...node, children: cloneTree(node.children, retained) }];
  });
}

export function filterCategoryTree<T extends CategoryRecord>(
  roots: CategoryTreeNode<T>[],
  filter: CategoryTreeFilter,
): CategoryTreeNode<T>[] {
  const parentId = parentKeyOf(filter.parentId);
  const allNodes = flattenCategoryTree(roots);
  const selectedRoot = parentId
    ? allNodes.find((node) => keyOf(node.id) === parentId)
    : undefined;
  if (parentId && !selectedRoot) return [];
  const baseRoots = selectedRoot ? [selectedRoot] : roots;
  const baseNodes = flattenCategoryTree(baseRoots);
  const keyword = keyOf(filter.keyword).toLocaleLowerCase();
  const warehouseType = keyOf(filter.warehouseType);
  const status = keyOf(filter.status);
  if (!keyword && !warehouseType && !status) return cloneTree(baseRoots);

  const parentById = new Map<string, string>();
  for (const node of baseNodes) {
    for (const child of node.children) parentById.set(keyOf(child.id), keyOf(node.id));
  }
  const retained = new Set<string>();
  const matches = baseNodes.filter(
    (node) =>
      (!keyword || String(node.name ?? '').toLocaleLowerCase().includes(keyword)) &&
      (!warehouseType || keyOf(node.warehouseType) === warehouseType) &&
      (!status || keyOf(node.status) === status),
  );
  for (const match of matches) {
    const descendantStack = [match];
    while (descendantStack.length) {
      const node = descendantStack.pop()!;
      retained.add(keyOf(node.id));
      descendantStack.push(...node.children);
    }
    let currentKey = keyOf(match.id);
    while (parentById.has(currentKey)) {
      currentKey = parentById.get(currentKey)!;
      retained.add(currentKey);
    }
  }
  return cloneTree(baseRoots, retained);
}
