/** Mirrors the BE ShopDto / CreateShopRequest / UpdateShopRequest. */

export type ShopDto = {
  id: string                         // UUID
  code: string                       // e.g. SHP001
  name: string
  address: string
  contactPhone1: string
  contactPhone2: string | null
  gstin: string | null
  inventoryId: string                // FK → inventories.id
  inventoryName: string              // joined from inventories.name
  active: boolean
}

export type CreateShopRequest = {
  code?: string                      // optional — BE auto-generates if blank
  name: string
  address: string
  contactPhone1: string
  contactPhone2?: string
  gstin?: string                     // 15-char Indian GSTIN when provided
  inventoryId: string                // required
  active?: boolean
}

export type UpdateShopRequest = {
  name: string
  address: string
  contactPhone1: string
  contactPhone2?: string
  gstin?: string
  inventoryId: string
  active: boolean
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
