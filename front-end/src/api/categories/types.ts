/** Mirrors the BE CategoryDto. */

export type CategoryDto = {
  id: number
  name: string
  active: boolean
}

export type CreateCategoryRequest = {
  name: string
  active?: boolean
}

export type UpdateCategoryRequest = {
  name: string
  active: boolean
}
