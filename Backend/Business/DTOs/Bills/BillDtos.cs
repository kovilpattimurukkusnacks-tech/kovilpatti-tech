namespace KovilpattiSnacks.Business.DTOs.Bills;

/// Product row for the POS billing screen grid + scan lookup.
public record BillingProductDto(
    Guid Id,
    string Code,
    string? Barcode,
    string Name,
    string? CategoryName,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal OnHand);

public record BillLineRequest(Guid ProductId, int Qty);

/// One tender line (feature #5). Multiple allowed — must sum to the total.
public record BillPaymentRequest(string Mode, decimal Amount);   // Mode: 'Cash' | 'UPI'

public record CreateBillRequest(
    List<BillPaymentRequest> Payments,
    List<BillLineRequest> Items,
    Guid? CustomerId,           // required only when a payment is 'Credit'
    string? Notes);

/// A recorded tender on a bill.
public record BillPaymentDto(Guid Id, string Mode, decimal Amount);

/// Returned by POST /api/bills — identity + totals of the issued bill.
public record BillCreatedDto(
    Guid Id,
    string Code,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount);

public record CancelBillRequest(
    string ReasonType,          // 'Mistake' | 'Duplicate' | 'CustomerRefused' | 'Other'
    string? ReasonNote);

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
    string? CancelReasonType,
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
    string? CancelReasonType,
    string? CancelReason,
    Guid? CustomerId,
    string? CustomerName,
    string? CustomerPhone,
    IReadOnlyList<BillItemDto> Items,
    IReadOnlyList<BillPaymentDto> Payments);
