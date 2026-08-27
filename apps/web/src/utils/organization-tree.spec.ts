import { describe, expect, it } from 'vitest';
import { buildOrganizationTree, type OrganizationTreeNode } from './organization-tree';

describe('organization tree helpers', () => {
  it('treats parentId 0 as a root and nests descendants', () => {
    const tree = buildOrganizationTree<OrganizationTreeNode>([
      { value: '2', label: '子组织', raw: { parentId: '1', sort: 2 } },
      { value: '1', label: '总部', raw: { parentId: '0', sort: 1 } },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ value: '1', label: '总部' });
    expect(tree[0]?.children?.[0]).toMatchObject({ value: '2', label: '子组织' });
  });

  it('keeps an organization with a missing parent selectable as a root', () => {
    const tree = buildOrganizationTree<OrganizationTreeNode>([
      { value: '9', label: '孤立组织', raw: { parentId: '99' } },
    ]);

    expect(tree.map((node) => node.value)).toEqual(['9']);
  });
});
