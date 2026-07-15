using FluentValidation;
using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.Accounts;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class AccountsService(
    IAccountsRepository accounts,
    ICurrentUser currentUser,
    IValidator<AccountsFilters> validator
) : IAccountsService
{
    public async Task<AccountsSummaryDto> GetSummaryAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var e = await accounts.GetSummaryAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds, ct);
        return new AccountsSummaryDto(
            e.Requested_Amount,
            e.Dispatched_Amount, e.Dispatched_Request_Count,
            e.Returns_Amount,    e.Returns_Request_Count,
            e.Net_Amount,        e.Active_Shop_Count,
            e.Adjustments_Amount, e.Adjustments_Count,
            e.Purchase_Amount);
    }

    public async Task<IReadOnlyList<AccountsTrendBucketDto>> GetTrendAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var grouping = string.IsNullOrWhiteSpace(filters.Grouping) ? "day" : filters.Grouping!;
        var rows = await accounts.GetTrendAsync(
            filters.From!.Value, filters.To!.Value, grouping,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds, ct);
        return rows.Select(r => new AccountsTrendBucketDto(
            r.Bucket_Start, r.Dispatched_Amount, r.Returns_Amount, r.Net_Amount,
            r.Purchase_Amount, r.Shortfall_Amount)).ToList();
    }

    public async Task<IReadOnlyList<AccountsShopRowDto>> GetByShopAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var rows = await accounts.GetByShopAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds, ct);
        return rows.Select(r => new AccountsShopRowDto(
            r.Shop_Id, r.Shop_Code, r.Shop_Name,
            r.Order_Request_Count, r.Return_Request_Count,
            r.Requested_Qty, r.Dispatched_Qty, r.Returned_Qty,
            r.Requested_Amount, r.Dispatched_Amount, r.Returns_Amount,
            r.Adjustments_Amount, r.Net_Amount,
            r.Purchase_Amount, r.Profit, r.Loss)).ToList();
    }

    public async Task<IReadOnlyList<AccountsCategoryRowDto>> GetByCategoryAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var rows = await accounts.GetByCategoryAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds, ct);
        return rows.Select(r => new AccountsCategoryRowDto(
            r.Category_Id, r.Category_Path, r.Quantity, r.Amount,
            r.Purchase_Amount, r.Profit, r.Loss,
            r.Requested_Qty, r.Dispatched_Qty, r.Returns_Qty,
            r.Requested_Amount, r.Dispatched_Amount, r.Returns_Amount)).ToList();
    }

    public async Task<IReadOnlyList<AccountsProductRowDto>> GetTopProductsAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var limit = filters.Limit ?? 10;
        var rows = await accounts.GetTopProductsAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds,
            limit, ct);
        return rows.Select(r => new AccountsProductRowDto(
            r.Product_Id, r.Product_Code, r.Product_Name,
            r.Weight_Value, r.Weight_Unit,
            r.Quantity, r.Amount,
            r.Requested_Qty, r.Dispatched_Qty, r.Returns_Qty,
            r.Requested_Amount, r.Dispatched_Amount, r.Returns_Amount)).ToList();
    }

    public async Task<IReadOnlyList<AccountsAdjustmentRowDto>> GetAdjustmentsAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        Guard(filters);
        var rows = await accounts.GetAdjustmentsAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, filters.InventoryIds, filters.CategoryIds, ct);
        return rows.Select(r => new AccountsAdjustmentRowDto(
            r.Audit_Id, r.Edited_At, r.Request_Id, r.Request_Code, r.Request_Type,
            r.Is_Special, r.Special_Label,
            r.Shop_Id, r.Shop_Name,
            r.Product_Id, r.Product_Name, r.Weight_Value, r.Weight_Unit,
            r.Old_Qty, r.New_Qty, r.Delta_Qty, r.Unit_Price, r.Delta_Amount,
            r.Reason, r.Edited_By_Id, r.Edited_By_Name)).ToList();
    }

    public async Task<AccountsInTransitDto> GetInTransitAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        // In-transit ignores the date range by design — only the shop /
        // inventory filters are honoured. We still re-check the caller is
        // Admin and validate any structural issues with the filter object
        // (Limit / Grouping values are irrelevant here and ignored).
        EnsureAdmin();
        var e = await accounts.GetInTransitAsync(filters.ShopIds, filters.InventoryIds, ct);
        return new AccountsInTransitDto(
            e.Request_Count, e.Total_Amount, e.Oldest_Dispatched_At,
            e.Special_Count, e.Special_Amount);
    }

    public async Task<IReadOnlyList<AccountsUtilityRowDto>> GetUtilitiesAsync(AccountsFilters filters, CancellationToken ct = default)
    {
        // Utilities use only From/To/ShopIds — inventory and product-category
        // filters are meaningless here (see the SP header). The Guard call
        // still validates From/To and re-checks the Admin role.
        Guard(filters);
        var rows = await accounts.GetUtilitiesAsync(
            filters.From!.Value, filters.To!.Value,
            filters.ShopIds, ct);
        return rows.Select(r => new AccountsUtilityRowDto(
            r.Shop_Id, r.Shop_Code, r.Shop_Name,
            r.Category, r.Amount, r.Expense_Count)).ToList();
    }

    // ──────── helpers ────────

    private void Guard(AccountsFilters filters)
    {
        EnsureAdmin();

        var result = validator.Validate(filters);
        if (!result.IsValid)
            throw new ValidationException(result.Errors);
    }

    private void EnsureAdmin()
    {
        // Controller is already [Authorize(Roles = "Admin")]; this is the
        // defence-in-depth second check so any future caller that bypasses
        // the controller (e.g. an internal job) still respects the role.
        if (currentUser.Role != RoleNames.Admin)
            throw new ForbiddenException("Accounts reports are restricted to admin users.");
    }
}
