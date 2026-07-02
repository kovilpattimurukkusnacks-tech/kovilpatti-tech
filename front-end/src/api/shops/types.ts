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
  /** 19-Jun-2026 (client #15): per-shop GST flag. Driven by the
   *  AdminSettings per-shop toggle when the global gst_enabled
   *  app-setting is true. */
  gstEnabled: boolean
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
  gstEnabled?: boolean               // 19-Jun-2026 (client #15). Defaults true on BE.
}

export type UpdateShopRequest = {
  name: string
  address: string
  contactPhone1: string
  contactPhone2?: string
  gstin?: string
  inventoryId: string
  active: boolean
  gstEnabled?: boolean               // 19-Jun-2026 (client #15)
}

/** PATCH /api/shops/{id}/gst-enabled body. Single bool. */
export type SetShopGstEnabledRequest = {
  enabled: boolean
}
