using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.ShopInventory;

namespace KovilpattiSnacks.Business.Interface;

/// Shop inventory service. Handles role-based shop scoping
/// (ShopUser: locked to own shop; Admin: may pass shopId).
public interface IShopInventoryService
{
    // ─── Inventory reads ────────────────────────────────
    Task<PagedResult<ShopInventoryRowDto>> ListOnHandAsync(
        Guid? shopId, string? search, int page, int pageSize, CancellationToken ct = default);

    Task<ShopInventoryDetailDto> GetOnHandAsync(
        Guid? shopId, Guid productId, CancellationToken ct = default);

    Task<IReadOnlyList<ShopInventoryLowStockDto>> LowStockAsync(
        Guid? shopId, decimal threshold, CancellationToken ct = default);

    Task<decimal> ValuationAsync(Guid? shopId, CancellationToken ct = default);

    Task<IReadOnlyList<ShopInventoryMovementDto>> ListMovementsAsync(
        Guid? shopId, Guid? productId, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default);

    /// Slim flat list of (product, category, on_hand) for the dashboard's
    /// category-tree browse view. No pagination.
    Task<IReadOnlyList<ShopInventoryTreeItemDto>> ListForTreeAsync(
        Guid? shopId, CancellationToken ct = default);

    // ─── Manual adjustment ──────────────────────────────
    /// Admin-only. Records a `ManualAdjustment` movement. Returns the
    /// refreshed detail so caches stay in sync.
    Task<ShopInventoryDetailDto> AdjustAsync(
        Guid? shopId, AdjustInventoryRequest request, CancellationToken ct = default);
}
