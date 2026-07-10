using FluentValidation.Results;
using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.ShopInventory;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using Npgsql;
using ForbiddenException     = KovilpattiSnacks.Business.Exceptions.ForbiddenException;
using NotFoundException      = KovilpattiSnacks.Business.Exceptions.NotFoundException;
using UnauthorizedException  = KovilpattiSnacks.Business.Exceptions.UnauthorizedException;
using ValidationException    = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

// Helper — the codebase ValidationException requires IEnumerable<ValidationFailure>
// (mirrors FluentValidation's shape). We wrap plain messages with a synthetic
// empty-name failure so error responses stay consistent with existing endpoints.
internal static class ShopInventoryServiceErrors
{
    public static ValidationException Validation(string message)
        => new(new[] { new ValidationFailure(string.Empty, message) });
}

public class ShopInventoryService(
    IShopInventoryRepository repo,
    ICurrentUser currentUser
) : IShopInventoryService
{
    // ═══════════════ Inventory reads ═══════════════

    public async Task<PagedResult<ShopInventoryRowDto>> ListOnHandAsync(
        Guid? shopId, string? search, int page, int pageSize, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 25 : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await repo.ListOnHandAsync(scopedShopId, search, safePage, safePageSize, ct);
        var items = rows.Select(MapOnHand).ToList();
        return new PagedResult<ShopInventoryRowDto>(items, total, safePage, safePageSize);
    }

    public async Task<ShopInventoryDetailDto> GetOnHandAsync(
        Guid? shopId, Guid productId, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var row = await repo.GetOnHandAsync(scopedShopId, productId, ct)
            ?? throw new NotFoundException(
                $"No inventory row for shop '{scopedShopId}' product '{productId}'.");
        return MapDetail(row);
    }

    public async Task<IReadOnlyList<ShopInventoryLowStockDto>> LowStockAsync(
        Guid? shopId, decimal threshold, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var rows = await repo.LowStockAsync(scopedShopId, threshold, ct);
        return rows.Select(r => new ShopInventoryLowStockDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.On_Hand, r.Mrp,
            r.Category_Id, r.Category_Name, r.Category_Path)).ToList();
    }

    public async Task<decimal> ValuationAsync(Guid? shopId, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        return await repo.ValuationAsync(scopedShopId, ct);
    }

    public async Task<IReadOnlyList<ShopInventoryMovementDto>> ListMovementsAsync(
        Guid? shopId, Guid? productId, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 50 : (pageSize > 200 ? 200 : pageSize);

        var rows = await repo.ListMovementsAsync(
            scopedShopId, productId, fromDate, toDate, safePage, safePageSize, ct);
        return rows.Select(MapMovement).ToList();
    }

    public async Task<IReadOnlyList<ShopInventoryTreeItemDto>> ListForTreeAsync(
        Guid? shopId, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var rows = await repo.ListForTreeAsync(scopedShopId, ct);
        return rows.Select(r => new ShopInventoryTreeItemDto(
            r.Product_Id, r.Product_Code, r.Product_Name,
            r.Category_Id, r.On_Hand, r.Mrp)).ToList();
    }

    // ═══════════════ Manual adjustment ═══════════════

    public async Task<ShopInventoryDetailDto> AdjustAsync(
        Guid? shopId, AdjustInventoryRequest request, CancellationToken ct = default)
    {
        // Admin-only per client policy — shop users must go through the
        // stock-take flow which produces the same Adjustment movement type
        // but with a session audit trail.
        if (!IsRole(RoleNames.Admin))
            throw new ForbiddenException("Only administrators can record manual adjustments.");

        if (request.QtyDelta == 0)
            throw ShopInventoryServiceErrors.Validation("QtyDelta must be non-zero.");

        // Admin must pass shopId explicitly — ResolveShopId throws otherwise.
        var scopedShopId = ResolveShopId(shopId);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("User id missing from token.");

        try
        {
            await repo.ManualAdjustmentAsync(
                scopedShopId, request.ProductId, request.QtyDelta, request.Reason, userId, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "23514")
        {
            // check_violation from fn_shop_inventory_apply_movement — the
            // adjustment would drive on_hand negative. Surface as a 400.
            throw ShopInventoryServiceErrors.Validation(
                "Adjustment rejected — would drive on-hand below zero. Check current stock.");
        }

        var refreshed = await repo.GetOnHandAsync(scopedShopId, request.ProductId, ct)
            ?? throw new NotFoundException(
                $"Adjustment succeeded but no inventory row for product '{request.ProductId}'.");
        return MapDetail(refreshed);
    }

    // ═══════════════ Stock-take flow ═══════════════

    public async Task<StockTakeDetailDto> StartStockTakeAsync(
        Guid? shopId, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("User id missing from token.");

        Guid newId;
        try
        {
            newId = await repo.StockTakeStartAsync(scopedShopId, userId, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "23505")
        {
            // unique_violation from partial index — a Draft is already open.
            throw ShopInventoryServiceErrors.Validation(
                "A draft stock-take is already open for this shop. Finish or cancel it first.");
        }

        return await GetStockTakeAsync(newId, ct);
    }

    public async Task<StockTakeDetailDto> UpsertStockTakeLineAsync(
        Guid stockTakeId, UpsertStockTakeLineRequest request, CancellationToken ct = default)
    {
        // Ownership check — a shop user can't touch another shop's session.
        await EnsureStockTakeAccessAsync(stockTakeId, ct);

        try
        {
            await repo.StockTakeUpsertLineAsync(
                stockTakeId, request.ProductId, request.CountedQty, request.Note, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "22023")
        {
            // invalid_parameter_value — session is Submitted / Cancelled.
            throw ShopInventoryServiceErrors.Validation(
                "Cannot edit lines on a submitted or cancelled stock-take.");
        }

        return await GetStockTakeAsync(stockTakeId, ct);
    }

    public async Task<StockTakeDetailDto> GetStockTakeAsync(
        Guid stockTakeId, CancellationToken ct = default)
    {
        var rows = await repo.StockTakeGetAsync(stockTakeId, ct);
        if (rows.Count == 0)
            throw new NotFoundException($"Stock-take '{stockTakeId}' not found.");

        // Ownership check on the returned session's shop_id
        var header = rows[0];
        EnsureShopScope(header.Shop_Id);

        // First row carries the header regardless of items. Items are any
        // row with a non-null product_id (LEFT JOIN → all-null items row on
        // empty sessions).
        var items = rows
            .Where(r => r.Product_Id.HasValue)
            .Select(r => new StockTakeItemDto(
                r.Product_Id!.Value,
                r.Product_Code!,
                r.Product_Name!,
                r.System_Qty!.Value,
                r.Counted_Qty!.Value,
                r.Qty_Diff!.Value,
                r.Item_Note))
            .ToList();

        return new StockTakeDetailDto(
            header.Id, header.Code, header.Shop_Id, header.Status,
            header.Started_At, header.Submitted_At, header.Notes, items);
    }

    public async Task<PagedResult<StockTakeSummaryDto>> ListStockTakesAsync(
        Guid? shopId, string? status, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default)
    {
        var scopedShopId = ResolveShopId(shopId);
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 25 : (pageSize > 200 ? 200 : pageSize);

        var rows = await repo.StockTakeListAsync(
            scopedShopId, status, fromDate, toDate, safePage, safePageSize, ct);

        var items = rows.Select(r => new StockTakeSummaryDto(
            r.Id, r.Code, r.Status, r.Started_At, r.Submitted_At,
            r.Item_Count, r.Diff_Count, r.Net_Diff_Qty)).ToList();

        // No dedicated count SP — return the visible page's length as total.
        // Client uses infinite-scroll / next-page probe pattern for stock-take
        // history. If the client asks for an accurate total later, add
        // fn_stock_take_count and wire it here.
        return new PagedResult<StockTakeSummaryDto>(items, items.Count, safePage, safePageSize);
    }

    public async Task<StockTakeDetailDto> SubmitStockTakeAsync(
        Guid stockTakeId, CancellationToken ct = default)
    {
        await EnsureStockTakeAccessAsync(stockTakeId, ct);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("User id missing from token.");

        try
        {
            await repo.StockTakeSubmitAsync(stockTakeId, userId, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "22023")
        {
            throw ShopInventoryServiceErrors.Validation(
                "Only draft stock-takes can be submitted. This session is already finalised.");
        }
        catch (PostgresException ex) when (ex.SqlState == "23514")
        {
            // check_violation — a computed adjustment would drive on_hand negative.
            throw ShopInventoryServiceErrors.Validation(
                "Submit rejected — one or more counted qtys would drive on-hand below zero. "
                + "Review the diffs and correct the counts before submitting.");
        }

        return await GetStockTakeAsync(stockTakeId, ct);
    }

    public async Task<StockTakeDetailDto> CancelStockTakeAsync(
        Guid stockTakeId, CancelStockTakeRequest request, CancellationToken ct = default)
    {
        await EnsureStockTakeAccessAsync(stockTakeId, ct);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("User id missing from token.");

        try
        {
            await repo.StockTakeCancelAsync(stockTakeId, request.Reason, userId, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "22023")
        {
            throw ShopInventoryServiceErrors.Validation("Cannot cancel a submitted stock-take.");
        }

        return await GetStockTakeAsync(stockTakeId, ct);
    }

    // ═══════════════ Helpers ═══════════════

    private bool IsRole(string role)
        => string.Equals(currentUser.Role, role, StringComparison.OrdinalIgnoreCase);

    /// Resolves the effective shopId for the current caller:
    ///   • ShopUser → always their own shop_id from claims. Any passed
    ///     shopId that doesn't match → 403 (defence-in-depth even though
    ///     ShopUser endpoints don't take shopId).
    ///   • Admin    → passed shopId as-is (null passes through — caller
    ///     validates if the endpoint requires a value).
    ///   • Other    → 403.
    /// Resolves the effective shopId for the current caller. Every downstream
    /// SP needs a concrete shop_id, so this returns non-nullable — callers
    /// don't need to null-check the result.
    ///   • ShopUser → their own shop_id from claims. Passing a different
    ///     shopId → 403. Missing ShopId claim → 401.
    ///   • Admin    → passed shopId, required. Missing → 400 ValidationException.
    ///   • Other    → 403.
    private Guid ResolveShopId(Guid? passedShopId)
    {
        if (IsRole(RoleNames.ShopUser))
        {
            var mine = currentUser.ShopId
                ?? throw new UnauthorizedException("ShopUser token missing ShopId claim.");
            if (passedShopId.HasValue && passedShopId.Value != mine)
                throw new ForbiddenException("Cannot access another shop's inventory.");
            return mine;
        }
        if (IsRole(RoleNames.Admin))
        {
            return passedShopId
                ?? throw ShopInventoryServiceErrors.Validation(
                    "shopId is required. Pass ?shopId=… as an admin.");
        }
        throw new ForbiddenException("Only shop users and administrators can access shop inventory.");
    }

    private void EnsureShopScope(Guid rowShopId)
    {
        if (IsRole(RoleNames.ShopUser) && currentUser.ShopId != rowShopId)
            throw new ForbiddenException("This resource does not belong to your shop.");
    }

    private async Task EnsureStockTakeAccessAsync(Guid stockTakeId, CancellationToken ct)
    {
        // Peek at the header via the same _get SP; throws 404 if missing,
        // enforces shop scope for ShopUser.
        _ = await GetStockTakeAsync(stockTakeId, ct);
    }

    // ═══════════════ Mappers ═══════════════

    private static ShopInventoryRowDto MapOnHand(ShopInventoryOnHand r) => new(
        r.Product_Id, r.Product_Code, r.Product_Name, r.Category_Name,
        r.Weight_Value, r.Weight_Unit, r.Mrp, r.On_Hand, r.Avg_Cost,
        r.Stock_Value, r.Last_Movement_At);

    private static ShopInventoryDetailDto MapDetail(ShopInventoryDetail r) => new(
        r.Shop_Id, r.Product_Id, r.Product_Code, r.Product_Name,
        r.On_Hand, r.Avg_Cost, r.Stock_Value, r.Last_Movement_At);

    private static ShopInventoryMovementDto MapMovement(ShopInventoryMovement r) => new(
        r.Id, r.Product_Id, r.Product_Code, r.Product_Name,
        r.Movement_Type, r.Qty_Delta, r.Qty_After, r.Unit_Cost,
        r.Ref_Type, r.Ref_Id, r.Note,
        r.Created_At, r.Created_By, r.Created_By_Name);
}
