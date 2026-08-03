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
    IValidator<CancelBillRequest> cancelValidator,
    IValidator<CreateBillReturnRequest> createReturnValidator
) : IBillService
{
    public async Task<IReadOnlyList<BillingProductDto>> BillingProductsAsync(
        string? search, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.BillingProductsAsync(shopId, Normalize(search), limit: 500, ct);
        return rows.Select(p => new BillingProductDto(
            p.Id, p.Code, p.Barcode, p.Name, p.Category_Name, p.Weight_Value, p.Weight_Unit,
            p.Mrp, p.On_Hand, p.Sold_Loose)).ToList();
    }

    public async Task<BillCreatedDto> CreateAsync(CreateBillRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();

        // Keys must match fn_bill_create's jsonb reads (x->>'productId' / 'qty'
        // / 'looseWeightG'). Exactly one of qty / looseWeightG is set per line;
        // the SP raises on both-null-or-both-set.
        var itemsJson = JsonSerializer.Serialize(
            request.Items.Select(i => new
            {
                productId    = i.ProductId,
                qty          = i.Qty,
                looseWeightG = i.LooseWeightG,
            }));
        // Keys must match fn_bill_create's payment reads (x->>'mode' / 'amount').
        var paymentsJson = JsonSerializer.Serialize(
            request.Payments.Select(p => new { mode = p.Mode, amount = p.Amount }));

        try
        {
            var created = await bills.CreateAsync(
                shopId, userId, request.CustomerId, paymentsJson, itemsJson, Normalize(request.Notes),
                request.DiscountKind, request.DiscountValue, ct);
            return new BillCreatedDto(
                created.Id, created.Code, created.Total_Items, created.Total_Qty,
                created.Subtotal, created.Discount_Amount, created.Total_Amount);
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
            await bills.CancelAsync(
                billId, shopId, userId, request.ReasonType, Normalize(request.ReasonNote), ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            // "Bill not found." / "already cancelled" — shop scoping happens
            // inside the SP, so another shop's bill reads as not found.
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
        var payments = await bills.GetPaymentsAsync(billId, ct);

        return new BillDetailDto(
            header.Id, header.Code, header.Status, header.Payment_Mode,
            header.Total_Items, header.Total_Qty,
            header.Subtotal, header.Discount_Kind, header.Discount_Value, header.Discount_Amount,
            header.Total_Amount, header.Notes,
            header.Created_At, header.Created_By_Name,
            header.Cancelled_At, header.Cancelled_By_Name, header.Cancel_Reason_Type, header.Cancel_Reason,
            header.Customer_Id, header.Customer_Name, header.Customer_Phone,
            items.Select(i => new BillItemDto(
                i.Id, i.Product_Id, i.Product_Code, i.Product_Name,
                i.Weight_Value, i.Weight_Unit,
                i.Qty, i.Loose_Weight_G, i.Pack_Weight_G_Snapshot,
                i.Unit_Price, i.Line_Total)).ToList(),
            payments.Select(p => new BillPaymentDto(p.Id, p.Mode, p.Amount)).ToList());
    }

    // ───────── Bill returns (feature #1) ─────────

    public async Task<IReadOnlyList<ReturnableItemDto>> ReturnableItemsAsync(
        Guid billId, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.ReturnableItemsAsync(billId, shopId, ct);
        if (rows.Count == 0)
            throw new NotFoundException($"Bill '{billId}' not found.");
        return rows.Select(r => new ReturnableItemDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.Weight_Value, r.Weight_Unit,
            r.Unit_Price, r.Billed_Qty, r.Returned_Qty, r.Returnable_Qty)).ToList();
    }

    public async Task<BillReturnCreatedDto> CreateReturnAsync(
        CreateBillReturnRequest request, CancellationToken ct = default)
    {
        var validation = await createReturnValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();

        // Keys must match fn_bill_return_create's jsonb reads (x->>'productId' / 'qty').
        var itemsJson = JsonSerializer.Serialize(
            request.Items.Select(i => new { productId = i.ProductId, qty = i.Qty }));

        try
        {
            var created = await bills.CreateReturnAsync(
                request.SourceBillId, shopId, userId, request.RefundMode,
                request.ReasonType, Normalize(request.ReasonNote), itemsJson, ct);
            return new BillReturnCreatedDto(
                created.Id, created.Code, created.Total_Items, created.Total_Qty, created.Total_Amount);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            // RAISE EXCEPTION from fn_bill_return_create — over-return, wrong
            // shop, cancelled bill, etc. "not found" surfaces as 404.
            if (ex.MessageText.Contains("not found", StringComparison.OrdinalIgnoreCase))
                throw new NotFoundException(ex.MessageText);
            throw BillServiceErrors.Validation(ex.MessageText);
        }
    }

    public async Task<PagedResult<BillReturnListItemDto>> ListReturnsAsync(
        string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.ListReturnsAsync(shopId, Normalize(search), from, to, page, pageSize, ct);
        var total = rows.Count > 0 ? rows[0].Total_Count : 0;
        var items = rows.Select(r => new BillReturnListItemDto(
            r.Id, r.Code, r.Source_Bill_Id, r.Source_Bill_Code, r.Refund_Mode,
            r.Reason_Type, r.Reason_Note, r.Total_Items, r.Total_Qty, r.Total_Amount,
            r.Created_At, r.Created_By_Name)).ToList();
        return new PagedResult<BillReturnListItemDto>(items, total, page, pageSize);
    }

    public async Task<BillReturnDetailDto> GetReturnAsync(Guid returnId, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var header = await bills.GetReturnAsync(returnId, shopId, ct)
            ?? throw new NotFoundException($"Return '{returnId}' not found.");
        var items = await bills.GetReturnItemsAsync(returnId, ct);

        return new BillReturnDetailDto(
            header.Id, header.Code, header.Source_Bill_Id, header.Source_Bill_Code,
            header.Refund_Mode, header.Reason_Type, header.Reason_Note,
            header.Total_Items, header.Total_Qty, header.Total_Amount,
            header.Created_At, header.Created_By_Name,
            items.Select(i => new BillReturnItemDto(
                i.Id, i.Product_Id, i.Product_Code, i.Product_Name,
                i.Weight_Value, i.Weight_Unit, i.Qty, i.Unit_Price, i.Line_Total)).ToList());
    }

    // ───────── Held (draft) bills (feature #3) ─────────

    public async Task<HeldBillCreatedDto> HoldAsync(CreateHoldRequest request, CancellationToken ct = default)
    {
        if (request.Items is null || request.Items.Count == 0)
            throw BillServiceErrors.Validation("Nothing to hold — the bill is empty.");
        if (request.Items.Select(i => i.ProductId).Distinct().Count() != request.Items.Count)
            throw BillServiceErrors.Validation("The same product appears twice — adjust the quantity on one line instead.");

        var shopId = RequireShopId();
        var userId = RequireUserId();
        var itemsJson = JsonSerializer.Serialize(
            request.Items.Select(i => new { productId = i.ProductId, qty = i.Qty }));
        try
        {
            var id = await bills.HoldCreateAsync(
                shopId, userId, request.CustomerId, Normalize(request.Label), Normalize(request.Note), itemsJson, ct);
            return new HeldBillCreatedDto(id);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            throw BillServiceErrors.Validation(ex.MessageText);
        }
    }

    public async Task<IReadOnlyList<HeldBillListItemDto>> ListHoldsAsync(CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await bills.HoldListAsync(shopId, ct);
        return rows.Select(r => new HeldBillListItemDto(
            r.Id, r.Label, r.Note, r.Customer_Name, r.Item_Count, r.Total_Qty, r.Total_Amount, r.Created_At)).ToList();
    }

    public async Task<HeldBillDetailDto> GetHoldAsync(Guid heldBillId, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var header = await bills.HoldGetAsync(heldBillId, shopId, ct)
            ?? throw new NotFoundException($"Held bill '{heldBillId}' not found.");
        var items = await bills.HoldGetItemsAsync(heldBillId, shopId, ct);
        return new HeldBillDetailDto(
            header.Id, header.Customer_Id, header.Label, header.Note,
            items.Select(i => new HeldBillItemDto(
                i.Id, i.Code, i.Barcode, i.Name, i.Weight_Value, i.Weight_Unit, i.Mrp, i.On_Hand, i.Qty)).ToList());
    }

    public async Task DeleteHoldAsync(Guid heldBillId, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        try
        {
            await bills.HoldDeleteAsync(heldBillId, shopId, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            throw new NotFoundException(ex.MessageText);
        }
    }

    // ───────── Helpers ─────────

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can use billing.");

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static BillListItemDto MapListItem(BillListRow r) => new(
        r.Id, r.Code, r.Status, r.Payment_Mode, r.Total_Items, r.Total_Qty,
        r.Subtotal, r.Discount_Amount, r.Total_Amount,
        r.Created_At, r.Created_By_Name, r.Cancelled_At,
        r.Cancel_Reason_Type, r.Cancel_Reason);
}
