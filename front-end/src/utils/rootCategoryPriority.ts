// Hard-coded display order for root (top-level) categories. Used by:
//   • ShopRequestNew  — drives the category dropdown order
//   • ShopRequestDetail / InventoryRequestDetail / AdminRequestDetail — group
//     the items grid under root-category headings in this order
//
// Names are normalised before comparison (lowercased + alphanumeric only),
// so minor DB variations ("1 Kg Snacks", "1kg Snacks", "1KG Snacks") all
// collapse to the same priority slot. Unknown roots fall to the end and
// sort alphabetically among themselves.

import type { CategoryDto } from '../api/categories/types'

export const ROOT_CAT_PRIORITY: readonly string[] = [
  '1kg Snacks',
  'Packing Items',
  // DB root is named "Murukku & Snacks Packed" — match that spelling exactly
  // (29-Jun-2026 fix; before this it sorted to the end as unknown).
  'Murukku & Snacks Packed',
  'Sweets',
  'Biscuits',
  'Cakes',
  'Pickle/Thokku/Podi',
  'Healthy Foods',
  'Millet Foods',
  'Dry Fruit & Nuts',
  'Shop Needs',
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const PRIORITY_MAP = (() => {
  const m = new Map<string, number>()
  ROOT_CAT_PRIORITY.forEach((name, i) => m.set(norm(name), i))
  return m
})()

/** Sort root-category names by the hard-coded priority order. Names not in
 *  the priority list sort to the end alphabetically among themselves. */
export function sortRootCategoryNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ai = PRIORITY_MAP.get(norm(a)) ?? Number.MAX_SAFE_INTEGER
    const bi = PRIORITY_MAP.get(norm(b)) ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.localeCompare(b)
  })
}

/**
 * Resolve a leaf category name to its root-category name using the loaded
 * categories list. `path` is " > "-joined names from root to leaf, so the
 * first segment is the root. Falls back to the leaf name itself when:
 *   • the category isn't found (data drift / new category not yet cached),
 *   • the category IS a root (path equals its own name), or
 *   • `path` is null (rare — bare-query SP that didn't traverse).
 *
 * Builds a lookup map once per caller; for many leaves call buildRootLookup
 * directly to amortise the cost.
 */
export function buildRootLookup(
  categories: readonly CategoryDto[] | undefined,
): (leafName: string) => string {
  // Map leaf NAME → root NAME. If multiple categories share a name (rare
  // but possible), the first one wins — matches the existing groupByCategoryWeight
  // behaviour which already coalesces same-named leaves.
  const byName = new Map<string, CategoryDto>()
  for (const c of categories ?? []) {
    if (!byName.has(c.name)) byName.set(c.name, c)
  }
  return (leafName: string) => {
    const cat = byName.get(leafName)
    if (!cat) return leafName // unknown — bucket under its own name
    if (!cat.path) return cat.name
    const firstSegment = cat.path.split(' > ')[0]?.trim() || cat.name
    return firstSegment
  }
}
