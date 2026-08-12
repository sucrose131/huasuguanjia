export type OrganizationTreeNode = {
  value: string | number;
  label: string;
  raw?: Record<string, any>;
  id?: string | number;
  name?: string;
  parentId?: string | number;
  sort?: number;
  children?: OrganizationTreeNode[];
  [key: string]: any;
};

export function buildOrganizationTree<T extends OrganizationTreeNode>(options: T[]): T[] {
  const nodes = new Map<string, T>();
  for (const option of options)
    nodes.set(String(option.value ?? option.id), { ...option, children: [] });

  const roots: T[] = [];
  for (const node of nodes.values()) {
    const parentId = String(node.raw?.parentId ?? node.parentId ?? 0);
    const parent = parentId !== '0' ? nodes.get(parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }

  const sortNodes = (items: T[]) => {
    items.sort((left, right) => {
      const sortDiff =
        Number(left.raw?.sort ?? left.sort ?? 0) - Number(right.raw?.sort ?? right.sort ?? 0);
      return (
        sortDiff ||
        String(left.label ?? left.name).localeCompare(String(right.label ?? right.name), 'zh-CN')
      );
    });
    for (const item of items) {
      if (item.children?.length) sortNodes(item.children as T[]);
      else delete item.children;
    }
  };
  sortNodes(roots);
  return roots;
}
