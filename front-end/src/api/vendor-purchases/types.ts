/** Mirrors the BE VendorPurchaseDto / CreateVendorPurchaseRequest / UpdateVendorPurchaseRequest. */

export type VendorPurchaseStatus = 'Ordered' | 'Received'

export type VendorPurchaseItemDto = {
  id: string
  productId: string
  productCode: string
  productName: string
  qty: number
  unitCost: number
  lineTotal: number
  weightValue: number | null
  weightUnit: string | null
}

export type VendorPurchaseDto = {
  id: string
  code: string                       // e.g. PUR0001
  vendorId: string
  vendorCode: string
  vendorName: string
  godownId: string
  godownCode: string
  godownName: string
  /** Derived server-side at insert time from vendor.stateCode. Frozen —
   *  not recomputed if the vendor's state changes later. */
  isInterstate: boolean
  invoiceNumber: string
  invoiceDate: string                // ISO date (yyyy-MM-dd)
  invoiceAmount: number
  status: VendorPurchaseStatus
  totalItems: number
  totalQty: number
  totalAmount: number
  notes: string | null
  receivedAt: string | null
  receivedByName: string | null
  createdAt: string
  /** Phase 5b — e-way compliance summary from the list SP. Null on GET /{id}
   *  because the detail page renders the full e-way section instead. */
  ewayStatus: 'NotRequired' | 'Attached' | 'Missing' | null
  /** Only populated by GET /{id}. Null/undefined on list rows. */
  items: VendorPurchaseItemDto[] | null
}

export type CreateVendorPurchaseItem = {
  productId: string
  qty: number
  unitCost: number
}

export type CreateVendorPurchaseRequest = {
  vendorId: string
  godownId: string
  invoiceNumber: string
  invoiceDate: string                 // ISO date (yyyy-MM-dd)
  invoiceAmount: number
  notes?: string
  items: CreateVendorPurchaseItem[]
}

// No vendorId/godownId — re-pointing a purchase after creation is a
// cancel-and-recreate, not an edit (mirrors BE UpdateVendorPurchaseRequest).
export type UpdateVendorPurchaseRequest = {
  invoiceNumber: string
  invoiceDate: string
  invoiceAmount: number
  notes?: string
  items: CreateVendorPurchaseItem[]
}

export type VendorPurchaseListFilters = {
  vendorId?: string
  godownId?: string
  status?: VendorPurchaseStatus
  isInterstate?: boolean
  fromDate?: string
  toDate?: string
  search?: string
  page?: number
  pageSize?: number
}

export type PagedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
