namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Everything the shop dashboard needs in ONE payload — one round trip from
/// the FE instead of a waterfall of 6 API calls. Assembled by
/// ShopDashboardService from ~5 phase-4 SPs plus the phase-2 request-count SP.
///
/// Widget mapping (see project_kovilpatti_shop_landing memory):
///   • InventoryValue    → "₹87,340 Total stock value"
///   • SkuCount          → "142 SKUs"
///   • LowStockCount     → red badge next to Low Stock header
///   • LowStock          → top-N urgent items
///   • TodayReceipts     → "⬆ 12 items received"
///   • TodayAdjustments  → "⚙ N adjustments today"
///   • RecentMovements   → last-10 activity feed
///   • PendingRequests   → phase-2 stock-request queue count
///   • LastStockTake     → nullable — "last count was N days ago" card
///
/// Fields populated only from the shop-inventory slice — sales / cash-in-till
/// / top-products / P&L come later when bills + cash slices land, and this
/// DTO grows accordingly.
public record ShopDashboardDto(
    Guid    ShopId,
    string  ShopCode,
    string  ShopName,

    // Snapshot
    decimal InventoryValue,
    long    SkuCount,

    // Low stock
    long    LowStockCount,
    IReadOnlyList<ShopInventoryLowStockDto> LowStock,      // top-N urgent items

    // Today's activity — from movement_summary bucketed by type
    long    TodayReceipts,       // total_lines where movement_type='Receipt'
    decimal TodayReceiptsQty,    // sum of qty_delta for the same
    long    TodayAdjustments,    // total_lines where movement_type='Adjustment'

    // Recent ledger — last-N movements across all products (from _movements)
    IReadOnlyList<ShopInventoryMovementDto> RecentMovements,

    // Phase-2 queue signals
    long    PendingRequestsCount,

    // Stock-take
    StockTakeSummaryDto? LastStockTake);
