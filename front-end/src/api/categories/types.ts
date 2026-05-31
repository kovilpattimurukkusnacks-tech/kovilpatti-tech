/** Mirrors the BE CategoryDto. */

export type CategoryDto = {
  id: number
  name: string
  /** NULL = root category. Self-FK on categories.id. */
  parentId: number | null
  /** Breadcrumb " > "-joined names from root to this node. Populated by the
   *  tree SPs; falsy on the rare bare query that doesn't traverse. */
  path: string | null
  /** 0 for roots, +1 per nesting level. */
  depth: number
  active: boolean
}

export type CreateCategoryRequest = {
  name: string
  /** Omit / null for a root category. */
  parentId?: number | null
  active?: boolean
}

export type UpdateCategoryRequest = {
  name: string
  /** Set to null to promote this row to a root. */
  parentId: number | null
  active: boolean
}
