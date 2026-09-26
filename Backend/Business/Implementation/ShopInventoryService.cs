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
        // Admin-only per client policy — no shop-user adjustment path today.
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

    // ═══════════════ Opening stock import (Phase 4d) ═══════════════

    private const int MaxImportRows = 5000;

    /// Sets each listed product's on-hand at the shop to the counted qty.
    /// Always previews first (dry run). When dryRun is false AND the preview
    /// has zero errors, the same rows are applied in one SP call (all-or-
    /// nothing). With any error the preview comes back with Applied = false
    /// so the admin sees exactly which rows to fix — nothing is written.
    public async Task<OpeningImportResultDto> ImportOpeningAsync(
        Guid? shopId, Stream fileStream, string fileName, bool dryRun, CancellationToken ct = default)
    {
        if (!IsRole(RoleNames.Admin))
            throw new ForbiddenException("Only administrators can import opening stock.");
        var scopedShopId = ResolveShopId(shopId);
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("User id missing from token.");

        List<OpeningStockImportParser.RawRow> raw;
        try { raw = OpeningStockImportParser.Parse(fileStream, fileName); }
        catch (Exception ex) { throw ShopInventoryServiceErrors.Validation(ex.Message); }

        if (raw.Count == 0)
            throw ShopInventoryServiceErrors.Validation("The file has no stock rows.");
        if (raw.Count > MaxImportRows)
            throw ShopInventoryServiceErrors.Validation(
                $"The file has {raw.Count} rows — the limit is {MaxImportRows} per import.");

        // Row-level checks that don't need the DB. These rows never reach the SP.
        var localErrors = new List<OpeningImportRowDto>();
        var sendRows = new List<object>();
        foreach (var r in raw)
        {
            string? error = null;
            decimal qty = 0, cost = 0;
            var hasCost = !string.IsNullOrWhiteSpace(r.UnitCost);

            if (string.IsNullOrWhiteSpace(r.Code))
                error = "Product code is required.";
            else if (!TryParseDecimal(r.Qty, out qty))
                error = "Qty must be a number.";
            else if (qty < 0)
                error = "Qty cannot be negative.";
            else if (qty != Math.Round(qty, 3))
                error = "Qty can have at most 3 decimal places.";
            else if (hasCost && !TryParseDecimal(r.UnitCost, out cost))
                error = "Unit cost must be a number.";
            else if (hasCost && cost < 0)
                error = "Unit cost cannot be negative.";

            if (error is not null)
            {
                localErrors.Add(new OpeningImportRowDto(
                    r.RowNumber, r.Code?.Trim() ?? string.Empty, null, null, null, null,
                    TryParseDecimal(r.Qty, out var q) ? q : (decimal?)null, null, "Error", error));
                continue;
            }
            sendRows.Add(new { rowNo = r.RowNumber, code = r.Code!.Trim(), qty, unitCost = hasCost ? cost : (decimal?)null });
        }

        var rowsJson = System.Text.Json.JsonSerializer.Serialize(sendRows);

        List<OpeningImportRow> preview = [];
        try
        {
            if (sendRows.Count > 0)
                preview = await repo.ImportOpeningAsync(scopedShopId, userId, rowsJson, dryRun: true, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            throw ShopInventoryServiceErrors.Validation(ex.MessageText);
        }

        var errorCount = localErrors.Count + preview.Count(p => p.Status == "Error");
        var applied = false;
        var result = preview;

        if (!dryRun && errorCount == 0 && sendRows.Count > 0)
        {
            try
            {
                result = await repo.ImportOpeningAsync(scopedShopId, userId, rowsJson, dryRun: false, ct);
                applied = true;
            }
            catch (PostgresException ex) when (ex.SqlState is "P0001" or "23514")
            {
                // P0001: the SP found errors after all (data changed between
                // preview and apply). 23514: an on-hand CHECK tripped.
                throw ShopInventoryServiceErrors.Validation(
                    ex.SqlState == "P0001" ? ex.MessageText : "Import rejected — a quantity would make on-hand negative.");
            }
        }

        var rows = result
            .Select(p => new OpeningImportRowDto(
                p.Row_No, p.Input_Code, p.Product_Id, p.Product_Code, p.Product_Name,
                p.Current_Qty, p.New_Qty, p.Delta, p.Status, p.Message))
            .Concat(localErrors)
            .OrderBy(r => r.RowNo)
            .ToList();

        return new OpeningImportResultDto(
            DryRun: dryRun,
            Applied: applied,
            ChangedCount: rows.Count(r => r.Status == "Changed"),
            UnchangedCount: rows.Count(r => r.Status == "Unchanged"),
            ErrorCount: errorCount,
            Rows: rows);
    }

    private static bool TryParseDecimal(string? raw, out decimal value)
        => decimal.TryParse(
            (raw ?? string.Empty).Trim().Replace(",", string.Empty),
            System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture,
            out value);

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
