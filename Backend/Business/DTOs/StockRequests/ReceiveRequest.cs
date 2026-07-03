namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Shop confirms receipt of a Dispatched request. Items list is OPTIONAL —
/// omit / null / empty for the one-click "all as-dispatched" fast path
/// (matches pre-02-Jul-2026 behaviour). Populated when the shop counted
/// a discrepancy at receive time; each entry stamps received_qty on that
/// line so admin has a paper trail without needing a Return.
///
/// ReceivedQty rules:
///   • ≥ 0 — 0 means the whole line was missing.
///   • Can exceed DispatchedQty ("over-count" — client explicitly asked for
///     this to be allowed since a mis-dispatch of 11 vs a claimed 10 is a
///     real scenario). Admin follows up out of band.
///   • Only lines that DIFFER from dispatched need to be in the payload —
///     any line the FE omits stays "no discrepancy noted" (NULL in DB).
public record ReceiveRequest(
    IReadOnlyList<ReceiveItem>? Items
);

public record ReceiveItem(
    Guid Id,
    int  ReceivedQty
);
