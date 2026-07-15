using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Bills;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using Npgsql;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

// Same shape as ShopInventoryServiceErrors — wraps a plain message in a
// synthetic empty-name failure so error responses stay consistent.
internal static class BillServiceErrors
{
    public static ValidationException Validation(string message)
        => new(new[] { new ValidationFailure(string.Empty, message) });
}

/// <summary>
/// Phase 4 — POS billing (minimal v1 slice: issue + cancel, Cash/UPI single
/// tender, MRP snapshot pricing, stock decremented through the shop-inventory
/// ledger inside fn_bill_create). ShopUser only; shop_id always resolves from
/// the JWT claim, never a caller-supplied value — same ownership shape as
/// ShopUtilityExpenseService.
/// </summary>
public class BillService(
    IBillRepository bills,
    ICurrentUser currentUser,
    IValidator<CreateBillRequest> createValidator,
    IValidator<CancelBillRequest> cancelValidator
) : IBillService
{
    public async Task<IReadOnlyList<BillingProductDto>> BillingProductsAsync(
        string? search, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.BillingProductsAsync(shopId, Normalize(search), limit: 500, ct);
        return rows.Select(p => new BillingProductDto(
            p.Id, p.Code, p.Barcode, p.Name, p.Weight_Value, p.Weight_Unit, p.Mrp, p.On_Hand)).ToList();
    }

    public async Task<BillCreatedDto> CreateAsync(CreateBillRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();

        // Keys must match fn_bill_create's jsonb reads (x->>'productId' / 'qty').
        var itemsJson = JsonSerializer.Serialize(
            request.Items.Select(i => new { productId = i.ProductId, qty = i.Qty }));

        try
        {
            var created = await bills.CreateAsync(
                shopId, userId, request.PaymentMode, itemsJson, Normalize(request.Notes), ct);
            return new BillCreatedDto(
                created.Id, created.Code, created.Total_Items, created.Total_Qty, created.Total_Amount);
        }
        catch (PostgresException ex) when (ex.SqlState == "23514")
        {
            // check_violation from fn_shop_inventory_apply_movement — an item
            // on the bill would drive on-hand below zero.
            throw BillServiceErrors.Validation(
                "Not enough stock for one of the items — check the on-hand quantity and try again.");
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            // RAISE EXCEPTION from fn_bill_create — messages are already
            // user-friendly (empty cart, duplicate line, inactive product…).
            throw BillServiceErrors.Validation(ex.MessageText);
        }
    }

    public async Task CancelAsync(Guid billId, CancelBillRequest request, CancellationToken ct = default)
    {
        var validation = await cancelValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();

        try
        {
            await bills.CancelAsync(billId, shopId, userId, request.Reason.Trim(), ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            // "Bill not found." / "already cancelled" — shop scoping happens
            // inside the SP, so another shop's bill also reads as not found.
            if (ex.MessageText.Contains("not found", StringComparison.OrdinalIgnoreCase))
                throw new NotFoundException(ex.MessageText);
            throw BillServiceErrors.Validation(ex.MessageText);
        }
    }

    public async Task<PagedResult<BillListItemDto>> ListAsync(
        string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.ListAsync(
            shopId, Normalize(search), Normalize(status), from, to, page, pageSize, ct);
        var total = rows.Count > 0 ? rows[0].Total_Count : 0;
        var items = rows.Select(MapListItem).ToList();
        return new PagedResult<BillListItemDto>(items, total, page, pageSize);
    }

    public async Task<BillDetailDto> GetAsync(Guid billId, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var header = await bills.GetAsync(billId, shopId, ct)
            ?? throw new NotFoundException($"Bill '{billId}' not found.");
        var items = await bills.GetItemsAsync(billId, ct);

        return new BillDetailDto(
            header.Id, header.Code, header.Status, header.Payment_Mode,
            header.Total_Items, header.Total_Qty, header.Total_Amount, header.Notes,
            header.Created_At, header.Created_By_Name,
            header.Cancelled_At, header.Cancelled_By_Name, header.Cancel_Reason,
            items.Select(i => new BillItemDto(
                i.Id, i.Product_Id, i.Product_Code, i.Product_Name,
                i.Weight_Value, i.Weight_Unit, i.Qty, i.Unit_Price, i.Line_Total)).ToList());
    }

    // ───────── Helpers ─────────

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can use billing.");

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static BillListItemDto MapListItem(BillListRow r) => new(
        r.Id, r.Code, r.Status, r.Payment_Mode, r.Total_Items, r.Total_Qty,
        r.Total_Amount, r.Created_At, r.Created_By_Name, r.Cancelled_At, r.Cancel_Reason);
}
