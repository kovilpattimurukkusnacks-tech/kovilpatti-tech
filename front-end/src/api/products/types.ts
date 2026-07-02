/** Mirrors the BE ProductDto / CreateProductRequest / UpdateProductRequest. */

export type ProductDto = {
  id: string                          // UUID
  code: string                        // e.g. P001 (auto-generated)
  name: string
  categoryId: number
  categoryName: string
  type: string                        // pack, bottle, jar, packet, can …
  weightValue: number | null
  weightUnit: string | null           // 'g' | 'kg' | 'pcs' | 'pkt'
  mrp: number
  purchasePrice: number | null        // null when caller is shop_user (BE filters)
  gst: number | null                  // GST % (0..100). Hidden in the UI for now.
  active: boolean
  /** True when this SKU is procured from a vendor (not made in-house).
   *  Drives the vendor-procured badge on the grid + the pre-check in
   *  the godown's Move-to-back-order dialog. */
  isVendorProcured: boolean
}

export type CreateProductRequest = {
  code?: string                       // optional — BE auto-generates if blank
  name: string
  categoryId: number
  type: string
  weightValue?: number | null
  weightUnit?: string | null
  mrp: number
  purchasePrice: number
  gst?: number | null                 // hidden — omit from the form
  active?: boolean
  /** True → this SKU is procured from a vendor. Omitted → defaults to false. */
  isVendorProcured?: boolean
}

export type UpdateProductRequest = {
  code?: string                       // optional — omit/blank → BE keeps existing code
  name: string
  categoryId: number
  type: string
  weightValue?: number | null
  weightUnit?: string | null
  mrp: number
  purchasePrice: number
  gst?: number | null                 // hidden — omit from the form; BE preserves existing value
  active: boolean
  /** Null / omitted → BE keeps existing value; explicit true/false updates it. */
  isVendorProcured?: boolean
}

export type ProductListFilters = {
  search?: string
  categoryIds?: number[]    // multi-select; empty/undefined = any
  types?: string[]          // multi-select; empty/undefined = any
  page?: number             // 1-indexed for BE
  pageSize?: number
}

export type ImportProductError = {
  rowNumber: number
  message: string
}

export type ImportProductSkipped = {
  rowNumber: number
  name: string
  reason: string
}

export type ImportProductsResult = {
  totalRows: number
  imported: number
  skipped: ImportProductSkipped[]
  errors: ImportProductError[]
}
