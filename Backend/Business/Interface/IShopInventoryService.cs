using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.ShopInventory;

namespace KovilpattiSnacks.Business.Interface;

/// Shop inventory + stock-take service. Handles role-based shop scoping
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

    // ─── Manual adjustment ──────────────────────────────
    /// Admin-only. Records a `ManualAdjustment` movement. Returns the
    /// refreshed detail so caches stay in sync.
    Task<ShopInventoryDetailDto> AdjustAsync(
        Guid? shopId, AdjustInventoryRequest request, CancellationToken ct = default);

    // ─── Stock-take flow ────────────────────────────────
    Task<StockTakeDetailDto> StartStockTakeAsync(Guid? shopId, CancellationToken ct = default);

    Task<StockTakeDetailDto> UpsertStockTakeLineAsync(
        Guid stockTakeId, UpsertStockTakeLineRequest request, CancellationToken ct = default);

    Task<StockTakeDetailDto> GetStockTakeAsync(Guid stockTakeId, CancellationToken ct = default);

    Task<PagedResult<StockTakeSummaryDto>> ListStockTakesAsync(
        Guid? shopId, string? status, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default);

    /// Submit → writes Adjustment movements for non-zero diffs. Returns
    /// the finalised session detail.
    Task<StockTakeDetailDto> SubmitStockTakeAsync(Guid stockTakeId, CancellationToken ct = default);

    Task<StockTakeDetailDto> CancelStockTakeAsync(
        Guid stockTakeId, CancelStockTakeRequest request, CancellationToken ct = default);
}
