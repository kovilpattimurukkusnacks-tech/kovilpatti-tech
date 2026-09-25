using FluentValidation.Results;
using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.AdminPos;
using KovilpattiSnacks.Business.DTOs.Bills;
using KovilpattiSnacks.Business.DTOs.Customers;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Phase 4d — admin-side POS views (read-only, all shops). The controller is
/// Admin-gated; the role is re-checked here as defence in depth, same as the
/// other services. Bill items / tenders / return lines reuse the shop-side
/// readers in IBillRepository (those SPs take only the bill / return id).
/// </summary>
public class AdminPosService(
    IAdminPosRepository adminPos,
    IBillRepository bills,
    ICurrentUser currentUser
) : IAdminPosService
{
    private const int MaxPageSize   = 200;
    private const int MaxRangeDays  = 366;

    // ───────── Bills ─────────

    public async Task<PagedResult<AdminBillListItemDto>> ListBillsAsync(
        Guid? shopId, string? search, string? status, string? paymentMode,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default)
    {
        RequireAdmin();
        ValidateOptionalRange(from, to);
        var (p, size) = Paging(page, pageSize);
        var rows = await adminPos.ListBillsAsync(
            shopId, Normalize(search), Normalize(status), Normalize(paymentMode), from, to, p, size, ct);
        var items = rows.Select(MapBill).ToList();
        return new PagedResult<AdminBillListItemDto>(items, rows.Count > 0 ? rows[0].Total_Count : 0, p, size);
    }

    public async Task<AdminBillDetailDto> GetBillAsync(Guid billId, CancellationToken ct = default)
    {
        RequireAdmin();
        var h = await adminPos.GetBillAsync(billId, ct)
            ?? throw new NotFoundException($"Bill '{billId}' not found.");
        var items    = await bills.GetItemsAsync(billId, ct);
        var payments = await bills.GetPaymentsAsync(billId, ct);
        var returns  = await adminPos.ListReturnsAsync(null, null, billId, null, null, 1, MaxPageSize, ct);

        return new AdminBillDetailDto(
            h.Id, h.Code, h.Shop_Id, h.Shop_Code, h.Shop_Name,
            h.Status, h.Payment_Mode, h.Total_Items, h.Total_Qty,
            h.Subtotal, h.Discount_Kind, h.Discount_Value, h.Discount_Amount, h.Total_Amount, h.Notes,
            h.Created_At, h.Created_By_Name,
            h.Cancelled_At, h.Cancelled_By_Name, h.Cancel_Reason_Type, h.Cancel_Reason,
            h.Customer_Id, h.Customer_Name, h.Customer_Phone,
            items.Select(i => new BillItemDto(
                i.Id, i.Product_Id, i.Product_Code, i.Product_Name,
                i.Weight_Value, i.Weight_Unit,
                i.Qty, i.Loose_Weight_G, i.Pack_Weight_G_Snapshot,
                i.Unit_Price, i.Line_Total)).ToList(),
            payments.Select(pm => new BillPaymentDto(pm.Id, pm.Mode, pm.Amount)).ToList(),
            returns.Select(MapReturn).ToList());
    }

    // ───────── Returns ─────────

    public async Task<PagedResult<AdminBillReturnListItemDto>> ListReturnsAsync(
        Guid? shopId, string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        RequireAdmin();
        ValidateOptionalRange(from, to);
        var (p, size) = Paging(page, pageSize);
        var rows = await adminPos.ListReturnsAsync(shopId, Normalize(search), null, from, to, p, size, ct);
        return new PagedResult<AdminBillReturnListItemDto>(
            rows.Select(MapReturn).ToList(), rows.Count > 0 ? rows[0].Total_Count : 0, p, size);
    }

    public async Task<AdminBillReturnDetailDto> GetReturnAsync(Guid returnId, CancellationToken ct = default)
    {
        RequireAdmin();
        var h = await adminPos.GetReturnAsync(returnId, ct)
            ?? throw new NotFoundException($"Return '{returnId}' not found.");
        var items = await bills.GetReturnItemsAsync(returnId, ct);
        return new AdminBillReturnDetailDto(
            h.Id, h.Code, h.Shop_Id, h.Shop_Code, h.Shop_Name,
            h.Source_Bill_Id, h.Source_Bill_Code, h.Refund_Mode, h.Reason_Type, h.Reason_Note,
            h.Total_Items, h.Total_Qty, h.Total_Amount, h.Created_At, h.Created_By_Name,
            items.Select(i => new BillReturnItemDto(
                i.Id, i.Product_Id, i.Product_Code, i.Product_Name,
                i.Weight_Value, i.Weight_Unit, i.Qty, i.Unit_Price, i.Line_Total)).ToList());
    }

    // ───────── Day-end closes ─────────

    public async Task<PagedResult<AdminEodSessionDto>> ListEodAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, bool varianceOnly,
        int page, int pageSize, CancellationToken ct = default)
    {
        RequireAdmin();
        ValidateOptionalRange(from, to);
        var (p, size) = Paging(page, pageSize);
        var rows = await adminPos.ListEodAsync(shopId, from, to, varianceOnly, p, size, ct);
        var items = rows.Select(r => new AdminEodSessionDto(
            r.Id, r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Window_From, r.Closed_At, r.Closed_By_Name,
            r.Cash_Sales, r.Upi_Sales, r.Credit_Sales, r.Cash_Refunds, r.Upi_Refunds, r.Cancel_Cash_Back,
            r.Expected_Cash, r.Physical_Cash, r.Variance, r.Notes)).ToList();
        return new PagedResult<AdminEodSessionDto>(items, rows.Count > 0 ? rows[0].Total_Count : 0, p, size);
    }

    public async Task<IReadOnlyList<AdminEodDenominationDto>> EodDenominationsAsync(
        Guid sessionId, CancellationToken ct = default)
    {
        RequireAdmin();
        var rows = await adminPos.EodDenominationsAsync(sessionId, ct);
        return rows.Select(r => new AdminEodDenominationDto(r.Denomination, r.Count, r.Amount)).ToList();
    }

    // ───────── Credit customers ─────────

    public async Task<AdminCustomerPageDto> ListCustomersAsync(
        Guid? shopId, string? search, bool outstandingOnly,
        int page, int pageSize, CancellationToken ct = default)
    {
        RequireAdmin();
        var (p, size) = Paging(page, pageSize);
        var rows = await adminPos.ListCustomersAsync(shopId, Normalize(search), outstandingOnly, p, size, ct);
        var items = rows.Select(r => new AdminCustomerDto(
            r.Id, r.Code, r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Name, r.Phone,
            r.Credit_Limit, r.Credit_Balance, r.Last_Credit_At, r.Last_Settlement_At, r.Created_At)).ToList();
        return new AdminCustomerPageDto(
            items,
            rows.Count > 0 ? rows[0].Total_Count : 0,
            p, size,
            rows.Count > 0 ? rows[0].Total_Outstanding : 0m);
    }

    public async Task<PagedResult<CustomerLedgerEntryDto>> CustomerLedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default)
    {
        RequireAdmin();
        var (p, size) = Paging(page, pageSize);
        var rows = await adminPos.CustomerLedgerAsync(customerId, p, size, ct);
        var items = rows.Select(r => new CustomerLedgerEntryDto(
            r.Id, r.Entry_Type, r.Amount, r.Mode, r.Note, r.Balance_After,
            r.Bill_Code, r.Created_At, r.Created_By_Name)).ToList();
        return new PagedResult<CustomerLedgerEntryDto>(items, rows.Count > 0 ? rows[0].Total_Count : 0, p, size);
    }

    // ───────── Sales reports ─────────

    public async Task<AdminSalesSummaryDto> SalesSummaryAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        RequireAdmin();
        var (f, t) = RequireRange(from, to);
        var s = await adminPos.SalesSummaryAsync(shopId, f, t, ct);
        return new AdminSalesSummaryDto(
            s.Bill_Count, s.Gross_Sales, s.Discount_Total, s.Sales_Total, s.Avg_Bill_Value,
            s.Cancelled_Count, s.Cancelled_Amount, s.Return_Count, s.Returns_Total, s.Net_Sales,
            s.Cash_Sales, s.Upi_Sales, s.Credit_Sales, s.Cash_Refunds, s.Upi_Refunds,
            s.Settlements_Cash, s.Settlements_Upi);
    }

    public async Task<IReadOnlyList<AdminSalesShopRowDto>> SalesByShopAsync(
        DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        RequireAdmin();
        var (f, t) = RequireRange(from, to);
        var rows = await adminPos.SalesByShopAsync(f, t, ct);
        return rows.Select(r => new AdminSalesShopRowDto(
            r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Bill_Count, r.Sales_Total, r.Discount_Total,
            r.Returns_Total, r.Net_Sales, r.Cancelled_Count, r.Cancelled_Amount,
            r.Cash_Sales, r.Upi_Sales, r.Credit_Sales)).ToList();
    }

    public async Task<IReadOnlyList<AdminSalesDayRowDto>> SalesDailyAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        RequireAdmin();
        var (f, t) = RequireRange(from, to);
        var rows = await adminPos.SalesDailyAsync(shopId, f, t, ct);
        return rows.Select(r => new AdminSalesDayRowDto(
            r.Day, r.Bill_Count, r.Sales_Total, r.Returns_Total, r.Net_Sales, r.Cancelled_Count,
            r.Cash_Sales, r.Upi_Sales, r.Credit_Sales)).ToList();
    }

    public async Task<IReadOnlyList<AdminSalesProductRowDto>> SalesTopProductsAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, int limit, CancellationToken ct = default)
    {
        RequireAdmin();
        var (f, t) = RequireRange(from, to);
        var safeLimit = limit < 1 ? 20 : Math.Min(limit, 100);
        var rows = await adminPos.SalesTopProductsAsync(shopId, f, t, safeLimit, ct);
        return rows.Select(r => new AdminSalesProductRowDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.Category_Name,
            r.Packets_Sold, r.Loose_Weight_G, r.Bill_Count, r.Revenue)).ToList();
    }

    // ───────── Helpers ─────────

    private void RequireAdmin()
    {
        if (!string.Equals(currentUser.Role, RoleNames.Admin, StringComparison.OrdinalIgnoreCase))
            throw new ForbiddenException("Only administrators can view POS reports.");
    }

    private static (int page, int pageSize) Paging(int page, int pageSize)
        => (page < 1 ? 1 : page, pageSize < 1 ? 25 : Math.Min(pageSize, MaxPageSize));

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// Reports need both ends — an open-ended aggregate over the whole history
    /// would be a full-table scan every time the page loads.
    private static (DateOnly from, DateOnly to) RequireRange(DateOnly? from, DateOnly? to)
    {
        if (from is null || to is null)
            throw Validation("range", "From and To dates are required (yyyy-MM-dd).");
        ValidateOptionalRange(from, to);
        return (from.Value, to.Value);
    }

    private static void ValidateOptionalRange(DateOnly? from, DateOnly? to)
    {
        if (from is null || to is null) return;
        if (from.Value > to.Value)
            throw Validation("range", "From date must be on or before To date.");
        if (to.Value.DayNumber - from.Value.DayNumber > MaxRangeDays)
            throw Validation("range", $"Date range cannot exceed {MaxRangeDays} days.");
    }

    private static ValidationException Validation(string field, string message)
        => new(new[] { new ValidationFailure(field, message) });

    private static AdminBillListItemDto MapBill(AdminBillListRow r) => new(
        r.Id, r.Code, r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Status, r.Payment_Mode,
        r.Total_Items, r.Total_Qty, r.Subtotal, r.Discount_Amount, r.Total_Amount, r.Returned_Amount,
        r.Customer_Name, r.Customer_Phone, r.Created_At, r.Created_By_Name,
        r.Cancelled_At, r.Cancelled_By_Name, r.Cancel_Reason_Type, r.Cancel_Reason);

    private static AdminBillReturnListItemDto MapReturn(AdminBillReturnListRow r) => new(
        r.Id, r.Code, r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Source_Bill_Id, r.Source_Bill_Code,
        r.Refund_Mode, r.Reason_Type, r.Reason_Note, r.Total_Items, r.Total_Qty, r.Total_Amount,
        r.Created_At, r.Created_By_Name);
}
