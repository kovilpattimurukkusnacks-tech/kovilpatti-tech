namespace KovilpattiSnacks.Business.DTOs.Bills;

/// Product row for the POS billing screen grid + scan lookup.
public record BillingProductDto(
    Guid Id,
    string Code,
    string? Barcode,
    string Name,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal OnHand);

public record BillLineRequest(Guid ProductId, int Qty);

public record CreateBillRequest(
    string PaymentMode,          // 'Cash' | 'UPI'
    List<BillLineRequest> Items,
    string? Notes);

/// Returned by POST /api/bills — identity + totals of the issued bill.
public record BillCreatedDto(
    Guid Id,
    string Code,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount);

public record CancelBillRequest(string Reason);

public record BillListItemDto(
    Guid Id,
    string Code,
    string Status,
    string PaymentMode,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? CancelledAt,
    string? CancelReason);

public record BillItemDto(
    Guid Id,
    Guid ProductId,
    string ProductCode,
    string ProductName,
    decimal? WeightValue,
    string? WeightUnit,
    int Qty,
    decimal UnitPrice,
    decimal LineTotal);

public record BillDetailDto(
    Guid Id,
    string Code,
    string Status,
    string PaymentMode,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount,
    string? Notes,
    DateTime CreatedAt,
    string? CreatedByName,
    DateTime? CancelledAt,
    string? CancelledByName,
    string? CancelReason,
    IReadOnlyList<BillItemDto> Items);
