/** Mirrors the BE ProductDto / CreateProductRequest / UpdateProductRequest. */

export type ProductDto = {
  id: string                          // UUID
  code: string                        // e.g. P001 (auto-generated)
  name: string
  categoryId: number
  categoryName: string
  type: string                        // pack, bottle, jar, packet, can …
  weightValue: number | null
  weightUnit: string | null           // 'g' | 'kg'
  mrp: number
  purchasePrice: number | null        // null when caller is shop_user (BE filters)
  active: boolean
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
  active?: boolean
}

export type UpdateProductRequest = {
  name: string
  categoryId: number
  type: string
  weightValue?: number | null
  weightUnit?: string | null
  mrp: number
  purchasePrice: number
  active: boolean
}

export type ProductListFilters = {
  search?: string
  categoryId?: number
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
