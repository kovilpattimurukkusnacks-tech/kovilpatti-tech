namespace KovilpattiSnacks.Business.DTOs.Bills;

// Phase 4c — held (draft) bills (feature #3).

public record CreateHoldRequest(
    Guid? CustomerId,
    string? Label,
    string? Note,
    List<BillLineRequest> Items);

public record HeldBillCreatedDto(Guid Id);

public record HeldBillListItemDto(
    Guid Id,
    string? Label,
    string? Note,
    string? CustomerName,
    int ItemCount,
    int TotalQty,
    decimal TotalAmount,
    DateTime CreatedAt);

/// Item carrying CURRENT product data so the POS rebuilds a cart line.
public record HeldBillItemDto(
    Guid ProductId,
    string Code,
    string? Barcode,
    string Name,
    decimal? WeightValue,
    string? WeightUnit,
    decimal Mrp,
    decimal OnHand,
    int Qty);

public record HeldBillDetailDto(
    Guid Id,
    Guid? CustomerId,
    string? Label,
    string? Note,
    IReadOnlyList<HeldBillItemDto> Items);
