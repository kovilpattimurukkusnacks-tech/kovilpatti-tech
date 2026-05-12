/** Mirrors the BE InventoryDto / CreateInventoryRequest / UpdateInventoryRequest. */

export type InventoryDto = {
  id: string                         // UUID
  code: string                       // e.g. INV001
  name: string
  address: string
  contactPhone: string
  contactPersonName: string | null
  active: boolean
}

export type CreateInventoryRequest = {
  code?: string                      // optional — BE auto-generates if blank
  name: string
  address: string
  contactPhone: string
  contactPersonName?: string
  active?: boolean                   // defaults to true server-side
}

export type UpdateInventoryRequest = {
  name: string
  address: string
  contactPhone: string
  contactPersonName?: string
  active: boolean
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
