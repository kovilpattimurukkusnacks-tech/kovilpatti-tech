namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// <summary>
/// Admin's post-completion correction to an item's <c>dispatched_qty</c>
/// (the "delivered amount" on Orders, the "accepted amount" on Returns).
/// Applies only to requests in status <c>Received</c> or <c>Accepted</c>.
///
/// <para>
/// <see cref="NewQty"/> is nullable so admin can also clear a stray
/// dispatched_qty back to NULL on an item that should never have been
/// counted as delivered. The underlying SP rejects values below 0.
/// </para>
///
/// <para>
/// <see cref="Reason"/> is optional free-text up to 500 chars. When omitted
/// (or whitespace-only), it's stored as NULL on the audit row. Phase 3
/// accounts uses this string verbatim on its reconciliation entries.
/// </para>
/// </summary>
public record EditDispatchedQtyRequest(int? NewQty, string? Reason);
