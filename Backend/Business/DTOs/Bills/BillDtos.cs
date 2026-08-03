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
    decimal OnHand,
    /// 01-Aug-2026 (Phase 4c). When true the POS renders a weight-input
    /// prompt when the cashier adds this product to the cart.
    bool SoldLoose);

/// A cart line — packet mode uses Qty (Int > 0), loose mode uses LooseWeightG
/// (grams, > 0). Exactly one of the two must be set per line (validator +
/// DB CHECK enforce). The SP re-checks products.sold_loose for loose lines.
public record BillLineRequest(Guid ProductId, int? Qty, decimal? LooseWeightG);

/// One tender line (feature #5). Multiple allowed — must sum to the total.
public record BillPaymentRequest(string Mode, decimal Amount);   // Mode: 'Cash' | 'UPI'

public record CreateBillRequest(
    List<BillPaymentRequest> Payments,
    List<BillLineRequest> Items,
    Guid? CustomerId,           // required only when a payment is 'Credit'
    string? Notes,
    /// Bill-level discount. 'Percent' → DiscountValue is 0-100.
    /// 'Amount' → flat ₹ off. Both null → no discount.
    string? DiscountKind = null,
    decimal? DiscountValue = null);

/// A recorded tender on a bill.
public record BillPaymentDto(Guid Id, string Mode, decimal Amount);

/// Returned by POST /api/bills — identity + totals of the issued bill.
/// 01-Aug-2026: Subtotal + DiscountAmount added so the FE can render the
/// receipt right away without a follow-up GET.
public record BillCreatedDto(
    Guid Id,
    string Code,
    int TotalItems,
    int TotalQty,
    decimal Subtotal,
    decimal DiscountAmount,
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
    decimal Subtotal,
    decimal DiscountAmount,
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
    /// Nullable — populated only for packet lines. Loose lines have LooseWeightG.
    int? Qty,
    /// 01-Aug-2026 (Phase 4c): grams for loose-weight lines.
    decimal? LooseWeightG,
    /// Pack weight (grams) captured at sale time for loose lines.
    decimal? PackWeightGSnapshot,
    decimal UnitPrice,
    decimal LineTotal);

public record BillDetailDto(
    Guid Id,
    string Code,
    string Status,
    string PaymentMode,
    int TotalItems,
    int TotalQty,
    decimal Subtotal,
    /// "Percent" | "Amount" | null (no discount applied)
    string? DiscountKind,
    /// The raw user input — 10 for "10%" or 50 for "₹50 off". Null when
    /// DiscountKind is null.
    decimal? DiscountValue,
    /// Computed ₹ actually taken off (Subtotal − TotalAmount).
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
    IReadOnlyList<BillPaymentDto> Payments);
