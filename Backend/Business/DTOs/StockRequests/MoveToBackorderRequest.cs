namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Godown carves selected items off a parent Order into a linked Backorder
/// sibling. Called by Inventory / Admin. ItemIds must all belong to the
/// parent request; ExpectedArrivalAt is optional (blank = "no ETA yet").
///
/// Returns the parent Order's refreshed DTO — its items list will now
/// exclude the moved lines, and BackorderChildren gains the new child.
public record MoveToBackorderRequest(
    IReadOnlyList<Guid> ItemIds,
    DateTimeOffset?     ExpectedArrivalAt
);
