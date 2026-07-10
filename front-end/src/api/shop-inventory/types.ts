// Client-side mirror of Backend/Business/DTOs/ShopInventory/*.cs
// Property names are camelCase — JsonSerializerOptions on the BE writes
// camelCase; do not use snake_case here.

export type ShopInventoryRowDto = {
  productId: string
  productCode: string
  productName: string
  categoryName: string
  weightValue: number | null
  weightUnit: string | null
  mrp: number
  onHand: number
  avgCost: number
  stockValue: number
  lastMovementAt: string | null
}

export type ShopInventoryDetailDto = {
  shopId: string
  productId: string
  productCode: string
  productName: string
  onHand: number
  avgCost: number
  stockValue: number
  lastMovementAt: string | null
}

export type ShopInventoryLowStockDto = {
  productId: string
  productCode: string
  productName: string
  onHand: number
  mrp: number
}

// Movement types match phase4_shop_inventory_procedures.sql check constraint:
//   Opening / Receipt / Sale / Return / Adjustment / Refund
export type MovementType =
  | 'Opening' | 'Receipt' | 'Sale' | 'Return' | 'Adjustment' | 'Refund'

// Ref types match the ref_type check constraint:
//   Opening / StockRequest / Bill / StockTake / ManualAdjustment / BillReturn
export type MovementRefType =
  | 'Opening' | 'StockRequest' | 'Bill' | 'StockTake' | 'ManualAdjustment' | 'BillReturn'

export type ShopInventoryMovementDto = {
  id: string
  productId: string
  productCode: string
  productName: string
  movementType: MovementType
  qtyDelta: number
  qtyAfter: number
  unitCost: number | null
  refType: MovementRefType
  refId: string | null
  note: string | null
  createdAt: string
  createdBy: string | null
  createdByName: string | null
}

export type StockTakeStatus = 'Draft' | 'Submitted' | 'Cancelled'

export type StockTakeSummaryDto = {
  id: string
  code: string
  status: StockTakeStatus
  startedAt: string
  submittedAt: string | null
  itemCount: number
  diffCount: number
  netDiffQty: number
}

export type StockTakeItemDto = {
  productId: string
  productCode: string
  productName: string
  systemQty: number
  countedQty: number
  qtyDiff: number
  note: string | null
}

export type StockTakeDetailDto = {
  id: string
  code: string
  shopId: string
  status: StockTakeStatus
  startedAt: string
  submittedAt: string | null
  notes: string | null
  items: StockTakeItemDto[]
}

export type ShopDashboardDto = {
  shopId: string
  shopCode: string
  shopName: string
  inventoryValue: number
  skuCount: number
  lowStockCount: number
  lowStock: ShopInventoryLowStockDto[]
  todayReceipts: number
  todayReceiptsQty: number
  todayAdjustments: number
  recentMovements: ShopInventoryMovementDto[]
  pendingRequestsCount: number
  lastStockTake: StockTakeSummaryDto | null
}

// ── Request bodies ──
export type AdjustInventoryRequest = {
  productId: string
  qtyDelta: number       // signed
  reason: string
}

export type UpsertStockTakeLineRequest = {
  productId: string
  countedQty: number     // ≥ 0
  note?: string | null
}

export type CancelStockTakeRequest = {
  reason: string
}

// ── Filters ──
export type ShopInventoryListFilters = {
  shopId?: string
  search?: string
  page?: number
  pageSize?: number
}

export type ShopInventoryMovementFilters = {
  shopId?: string
  fromDate?: string      // ISO date "YYYY-MM-DD"
  toDate?: string
  page?: number
  pageSize?: number
}

export type StockTakeListFilters = {
  shopId?: string
  status?: StockTakeStatus
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
}
