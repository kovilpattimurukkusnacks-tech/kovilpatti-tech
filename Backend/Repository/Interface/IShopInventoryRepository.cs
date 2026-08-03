using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

/// Dapper wrapper over Phase 4 shop-inventory SPs. Every method calls one
/// SP declared in phase4_shop_inventory_procedures.sql.
public interface IShopInventoryRepository
{
    // ─── On-hand reads ──────────────────────────────────
    Task<(List<ShopInventoryOnHand> Rows, long Total)> ListOnHandAsync(
        Guid shopId, string? search, int page, int pageSize, CancellationToken ct = default);

    Task<ShopInventoryDetail?> GetOnHandAsync(
        Guid shopId, Guid productId, CancellationToken ct = default);

    Task<IReadOnlyList<ShopInventoryLowStock>> LowStockAsync(
        Guid shopId, decimal threshold, CancellationToken ct = default);

    Task<decimal> ValuationAsync(Guid shopId, CancellationToken ct = default);

    // ─── Movement reads ─────────────────────────────────
    Task<IReadOnlyList<ShopInventoryMovement>> ListMovementsAsync(
        Guid shopId, Guid? productId, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default);

    Task<IReadOnlyList<ShopInventoryMovementBucket>> MovementSummaryAsync(
        Guid shopId, DateOnly fromDate, DateOnly toDate, CancellationToken ct = default);

    /// Every product with an inventory row for this shop, slim payload
    /// (product + category_id + on_hand + mrp). Used by the dashboard
    /// category-tree browse view.
    Task<IReadOnlyList<ShopInventoryTreeItem>> ListForTreeAsync(
        Guid shopId, CancellationToken ct = default);

    // ─── Manual adjustment (admin only — enforced in the service layer) ─
    /// Returns the id of the shop_inventory_movements row written.
    /// Raises 23514 (check_violation) if the adjustment would drive
    /// on_hand negative — service catches + surfaces as 400.
    Task<Guid> ManualAdjustmentAsync(
        Guid shopId, Guid productId, decimal qtyDelta, string reason,
        Guid createdBy, CancellationToken ct = default);

}
