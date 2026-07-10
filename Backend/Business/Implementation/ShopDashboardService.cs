using FluentValidation.Results;
using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.ShopInventory;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;
using ForbiddenException     = KovilpattiSnacks.Business.Exceptions.ForbiddenException;
using NotFoundException      = KovilpattiSnacks.Business.Exceptions.NotFoundException;
using UnauthorizedException  = KovilpattiSnacks.Business.Exceptions.UnauthorizedException;
using ValidationException    = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class ShopDashboardService(
    IShopInventoryRepository invRepo,
    IStockRequestRepository stockRequestRepo,
    IShopRepository shopRepo,
    ICurrentUser currentUser
) : IShopDashboardService
{
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);
    private const int LowStockTopN         = 5;   // Top-N urgent items to show on the card
    private const int RecentMovementsCount = 10;  // Ledger feed row count
    private const decimal LowStockThreshold = 5m; // Same default as fn_shop_inventory_low_stock

    public async Task<ShopDashboardDto> GetAsync(Guid? shopId, CancellationToken ct = default)
    {
        // Admin must pass shopId; ShopUser gets their own from the claim.
        // ResolveShopId throws internally if either path can't yield a value.
        var scopedShopId = ResolveShopId(shopId);

        // Shop header (code + name)
        var shop = await shopRepo.GetAsync(scopedShopId, ct)
            ?? throw new NotFoundException($"Shop '{scopedShopId}' not found.");

        // Today window in IST — Postgres stores UTC but the client thinks
        // in IST, so we scope movement_summary by the IST calendar day.
        var istNow    = DateTime.UtcNow.Add(IstOffset);
        var istToday  = DateOnly.FromDateTime(istNow);

        // Fire the underlying reads concurrently — none of them mutate,
        // and each opens its own short-lived connection via the factory.
        // Cuts dashboard load latency ~4x vs sequential awaits.
        var valuationTask  = invRepo.ValuationAsync(scopedShopId, ct);
        var onHandTask     = invRepo.ListOnHandAsync(scopedShopId, null, 1, 1, ct);        // page-1, size 1 → we only need the total count
        var lowStockTask   = invRepo.LowStockAsync(scopedShopId, LowStockThreshold, ct);
        var todayBucketsTask = invRepo.MovementSummaryAsync(scopedShopId, istToday, istToday, ct);
        var recentTask     = invRepo.ListMovementsAsync(scopedShopId, null, null, null, 1, RecentMovementsCount, ct);
        var pendingReqsTask = stockRequestRepo.ListPagedAsync(
            scopedShopId, null, "Pending", null, 1, 1, null, null, null, ct);
        var lastTakeTask   = invRepo.StockTakeListAsync(
            scopedShopId, null, null, null, 1, 1, ct);

        await Task.WhenAll(
            valuationTask, onHandTask, lowStockTask, todayBucketsTask,
            recentTask, pendingReqsTask, lastTakeTask);

        var valuation     = await valuationTask;
        var (_, skuCount) = await onHandTask;
        var lowStock      = await lowStockTask;
        var todayBuckets  = await todayBucketsTask;
        var recent        = await recentTask;
        var (_, pendingReqCount) = await pendingReqsTask;
        var lastTakeRows  = await lastTakeTask;

        // Extract today's Receipt + Adjustment buckets from the summary
        var receiptBucket    = todayBuckets.FirstOrDefault(b => b.Movement_Type == "Receipt");
        var adjustmentBucket = todayBuckets.FirstOrDefault(b => b.Movement_Type == "Adjustment");

        // Map low-stock top-N (category + breadcrumb travel with each row so
        // the dashboard shows "1KG Snacks > Chips 300" in bold above the
        // product name — client asked 10-Jul-2026).
        var lowStockDtos = lowStock
            .Take(LowStockTopN)
            .Select(l => new ShopInventoryLowStockDto(
                l.Product_Id, l.Product_Code, l.Product_Name, l.On_Hand, l.Mrp,
                l.Category_Id, l.Category_Name, l.Category_Path))
            .ToList();

        // Map recent movements
        var recentDtos = recent.Select(m => new ShopInventoryMovementDto(
            m.Id, m.Product_Id, m.Product_Code, m.Product_Name,
            m.Movement_Type, m.Qty_Delta, m.Qty_After, m.Unit_Cost,
            m.Ref_Type, m.Ref_Id, m.Note,
            m.Created_At, m.Created_By, m.Created_By_Name)).ToList();

        StockTakeSummaryDto? lastTake = null;
        if (lastTakeRows.Count > 0)
        {
            var r = lastTakeRows[0];
            lastTake = new StockTakeSummaryDto(
                r.Id, r.Code, r.Status, r.Started_At, r.Submitted_At,
                r.Item_Count, r.Diff_Count, r.Net_Diff_Qty);
        }

        return new ShopDashboardDto(
            ShopId:         shop.Id,
            ShopCode:       shop.Code,
            ShopName:       shop.Name,
            InventoryValue: valuation,
            SkuCount:       skuCount,
            LowStockCount:  lowStock.Count,
            LowStock:       lowStockDtos,
            TodayReceipts:      receiptBucket?.Total_Lines ?? 0,
            TodayReceiptsQty:   receiptBucket?.Total_Qty ?? 0m,
            TodayAdjustments:   adjustmentBucket?.Total_Lines ?? 0,
            RecentMovements:    recentDtos,
            PendingRequestsCount: pendingReqCount,
            LastStockTake:      lastTake);
    }

    private bool IsRole(string role)
        => string.Equals(currentUser.Role, role, StringComparison.OrdinalIgnoreCase);

    /// Resolves the caller's effective shop_id, non-nullable.
    ///   • ShopUser → own claim; passing a different shopId → 403.
    ///   • Admin    → must pass shopId (400 if omitted).
    ///   • Other    → 403.
    private Guid ResolveShopId(Guid? passedShopId)
    {
        if (IsRole(RoleNames.ShopUser))
        {
            var mine = currentUser.ShopId
                ?? throw new UnauthorizedException("ShopUser token missing ShopId claim.");
            if (passedShopId.HasValue && passedShopId.Value != mine)
                throw new ForbiddenException("Cannot access another shop's dashboard.");
            return mine;
        }
        if (IsRole(RoleNames.Admin))
        {
            return passedShopId
                ?? throw new ValidationException(new[]
                {
                    new ValidationFailure(string.Empty,
                        "shopId is required. Pass ?shopId=… as an admin.")
                });
        }
        throw new ForbiddenException("Only shop users and administrators can access the shop dashboard.");
    }
}
