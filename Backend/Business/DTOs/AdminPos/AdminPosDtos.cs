using KovilpattiSnacks.Business.DTOs.Bills;

namespace KovilpattiSnacks.Business.DTOs.AdminPos;

// Phase 4d (25-Sep-2026) — admin-side POS views. Everything here is read-
// only; ShopId on each row names the owning shop because the admin lists
// span all shops.

public record AdminBillListItemDto(
    Guid Id,
    string Code,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    string Status,
    string PaymentMode,
    int TotalItems,
    int TotalQty,
    decimal Subtotal,
    decimal DiscountAmount,
    decimal TotalAmount,
    /// Σ of returns recorded against this bill (0 when none).
    decimal ReturnedAmount,
    string? CustomerName,
    string? CustomerPhone,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? CancelledAt,
    string? CancelledByName,
    string? CancelReasonType,
    string? CancelReason);

public record AdminBillDetailDto(
    Guid Id,
    string Code,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    string Status,
    string PaymentMode,
    int TotalItems,
    int TotalQty,
    decimal Subtotal,
    string? DiscountKind,
    decimal? DiscountValue,
    decimal DiscountAmount,
    decimal TotalAmount,
    string? Notes,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? CancelledAt,
    string? CancelledByName,
    string? CancelReasonType,
    string? CancelReason,
    Guid? CustomerId,
    string? CustomerName,
    string? CustomerPhone,
    IReadOnlyList<BillItemDto> Items,
    IReadOnlyList<BillPaymentDto> Payments,
    /// Returns recorded against this bill, newest first.
    IReadOnlyList<AdminBillReturnListItemDto> Returns);

public record AdminBillReturnListItemDto(
    Guid Id,
    string Code,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    Guid SourceBillId,
    string SourceBillCode,
    string RefundMode,
    string ReasonType,
    string? ReasonNote,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount,
    DateTime CreatedAt,
    string? CreatedByName);

public record AdminBillReturnDetailDto(
    Guid Id,
    string Code,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    Guid SourceBillId,
    string SourceBillCode,
    string RefundMode,
    string ReasonType,
    string? ReasonNote,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount,
    DateTime CreatedAt,
    string? CreatedByName,
    IReadOnlyList<BillReturnItemDto> Items);

public record AdminEodSessionDto(
    Guid Id,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    DateTime WindowFrom,
    DateTime ClosedAt,
    string? ClosedByName,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales,
    decimal CashRefunds,
    decimal UpiRefunds,
    decimal CancelCashBack,
    decimal ExpectedCash,
    decimal PhysicalCash,
    /// Physical − expected. Negative = shortage.
    decimal Variance,
    string? Notes);

public record AdminEodDenominationDto(int Denomination, int Count, decimal Amount);

public record AdminCustomerDto(
    Guid Id,
    string Code,
    Guid ShopId,
    string ShopCode,
    string ShopName,
    string Name,
    string Phone,
    decimal CreditLimit,
    decimal CreditBalance,
    DateTime? LastCreditAt,
    DateTime? LastSettlementAt,
    DateTime CreatedAt);

/// Customer page + the outstanding total across the WHOLE filtered set
/// (not just this page) so the header can show "₹X across N customers".
public record AdminCustomerPageDto(
    IReadOnlyList<AdminCustomerDto> Items,
    long Total,
    int Page,
    int PageSize,
    decimal TotalOutstanding);

public record AdminSalesSummaryDto(
    long BillCount,
    decimal GrossSales,
    decimal DiscountTotal,
    decimal SalesTotal,
    decimal AvgBillValue,
    long CancelledCount,
    decimal CancelledAmount,
    long ReturnCount,
    decimal ReturnsTotal,
    decimal NetSales,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales,
    decimal CashRefunds,
    decimal UpiRefunds,
    decimal SettlementsCash,
    decimal SettlementsUpi);

public record AdminSalesShopRowDto(
    Guid ShopId,
    string ShopCode,
    string ShopName,
    long BillCount,
    decimal SalesTotal,
    decimal DiscountTotal,
    decimal ReturnsTotal,
    decimal NetSales,
    long CancelledCount,
    decimal CancelledAmount,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales);

public record AdminSalesDayRowDto(
    DateOnly Day,
    long BillCount,
    decimal SalesTotal,
    decimal ReturnsTotal,
    decimal NetSales,
    long CancelledCount,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales);

public record AdminSalesProductRowDto(
    Guid ProductId,
    string ProductCode,
    string ProductName,
    string? CategoryName,
    long PacketsSold,
    decimal LooseWeightG,
    long BillCount,
    decimal Revenue);
