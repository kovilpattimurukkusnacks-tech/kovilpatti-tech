namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// <summary>
/// Shop user creates a Return — items going BACK to the godown. Optionally
/// linked to a past Order (SourceRequestId) so Phase 3 accounts can reverse
/// that exact posting. SourceRequestId NULL = free-form return (current MRP
/// will be used as the unit price fallback).
///
/// Implements IStockRequestPayload so it reuses the shared validator base
/// (notes ≤ 500, ≥1 item, no duplicate product ids, item-level rules).
/// </summary>
public record CreateReturnRequest(
    /// Optional FK to the original Order being returned. NULL = free-form return.
    Guid? SourceRequestId,
    string? Notes,
    IReadOnlyList<CreateStockRequestItem> Items
) : IStockRequestPayload;
