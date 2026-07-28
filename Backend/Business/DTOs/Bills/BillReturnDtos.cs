namespace KovilpattiSnacks.Business.DTOs.Bills;

// Phase 4b — Bill returns (feature #1). Cash/UPI refund, partial + full.
// Reason categories: Damaged | WrongItem | ChangedMind | Other.

/// A source-bill line with how much of it can still be returned.
public record ReturnableItemDto(
    Guid ProductId,
    string ProductCode,
    string ProductName,
    decimal? WeightValue,
    string? WeightUnit,
    decimal UnitPrice,
    int BilledQty,
    int ReturnedQty,
    int ReturnableQty);

public record ReturnLineRequest(Guid ProductId, int Qty);

public record CreateBillReturnRequest(
    Guid SourceBillId,
    string RefundMode,          // 'Cash' | 'UPI'
    string ReasonType,          // 'Damaged' | 'WrongItem' | 'ChangedMind' | 'Other'
    string? ReasonNote,
    List<ReturnLineRequest> Items);

/// Returned by POST /api/bills/returns — identity + totals of the return.
public record BillReturnCreatedDto(
    Guid Id,
    string Code,
    int TotalItems,
    int TotalQty,
    decimal TotalAmount);

public record BillReturnListItemDto(
    Guid Id,
    string Code,
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

public record BillReturnItemDto(
    Guid Id,
    Guid ProductId,
    string ProductCode,
    string ProductName,
    decimal? WeightValue,
    string? WeightUnit,
    int Qty,
    decimal UnitPrice,
    decimal LineTotal);

public record BillReturnDetailDto(
    Guid Id,
    string Code,
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
