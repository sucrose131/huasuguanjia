import { describe, expect, it } from 'vitest';
import { buildCategoryTree, filterCategoryTree, flattenCategoryTree } from './category-tree';

const categories = [
  { id: '1', name: '物资', parentId: '0', warehouseType: 1, status: 1 },
  { id: '2', name: '办公用品', parentId: '1', warehouseType: 1, status: 1 },
  { id: '3', name: '纸张', parentId: '2', warehouseType: 1, status: 2 },
  { id: '4', name: '设备', parentId: '0', warehouseType: 2, status: 1 },
];

describe('category tree helpers', () => {
  it('builds nested categories and records their depth', () => {
    const tree = buildCategoryTree(categories);

    expect(tree.map((node) => node.id)).toEqual(['1', '4']);
    expect(tree[0]?.children[0]?.id).toBe('2');
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('keeps matching ancestors and descendants when filtering', () => {
    const result = filterCategoryTree(buildCategoryTree(categories), { keyword: '办公' });

    expect(flattenCategoryTree(result).map((node) => node.id)).toEqual(['1', '2', '3']);
  });

  it('uses the selected category as the subtree root', () => {
    const result = filterCategoryTree(buildCategoryTree(categories), { parentId: '2' });

    expect(flattenCategoryTree(result).map((node) => node.id)).toEqual(['2', '3']);
  });

  it('does not recurse forever when data contains cycles or missing parents', () => {
    const tree = buildCategoryTree([
      { id: '10', name: '循环A', parentId: '11' },
      { id: '11', name: '循环B', parentId: '10' },
      { id: '12', name: '孤儿分类', parentId: '99' },
    ]);

    expect(tree).toHaveLength(3);
    expect(tree.every((node) => node.hierarchyWarning)).toBe(true);
  });
});
