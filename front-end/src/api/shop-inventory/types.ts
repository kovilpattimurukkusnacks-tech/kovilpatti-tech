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
  categoryId: number | null
  categoryName: string | null      // leaf, e.g. "Chips 300"
  categoryPath: string | null      // full breadcrumb, e.g. "1KG Snacks > Chips 300"
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

// Slim row for the dashboard's category-tree browse. FE groups by
// categoryId and rolls up onHand through the categories tree (fetched
// separately via /api/categories).
export type ShopInventoryTreeItemDto = {
  productId: string
  productCode: string
  productName: string
  categoryId: number
  onHand: number
  mrp: number
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
}

// ── Request bodies ──
export type AdjustInventoryRequest = {
  productId: string
  qtyDelta: number       // signed
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

