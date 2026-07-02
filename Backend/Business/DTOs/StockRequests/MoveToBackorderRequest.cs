namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Godown carves selected items off a parent Order into a linked Backorder
/// sibling. Called by Inventory / Admin. Every item's Id must belong to
/// the parent; Qty must be > 0 and ≤ the parent line's requested_qty.
///   • Qty == full requested_qty → row is moved (full carve)
///   • Qty <  full requested_qty → row is SPLIT (parent keeps the remainder,
///                                  new row created on the child for Qty)
/// ExpectedArrivalAt is optional (blank = "no ETA yet").
///
/// Returns the parent Order's refreshed DTO — items list updated (moved
/// rows removed, split rows reduced), and BackorderChildren gains the
/// new child.
public record MoveToBackorderRequest(
    IReadOnlyList<MoveToBackorderItem> Items,
    DateTimeOffset?                     ExpectedArrivalAt
);

public record MoveToBackorderItem(
    Guid Id,
    int  Qty
);
