namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Shop confirms receipt of a Dispatched request. Items list is OPTIONAL —
/// omit / null / empty for the one-click "all as-dispatched" fast path
/// (matches pre-02-Jul-2026 behaviour). Populated when the shop counted
/// a discrepancy at receive time; each entry stamps received_qty (or the
/// partial-weight companion) on that line so admin has a paper trail
/// without needing a Return.
///
/// Rules:
///   • Full-pack line: set ReceivedQty (≥ 0). 0 means the line was missing.
///     Can exceed DispatchedQty (over-count) — real scenario per client.
///   • Partial-weight line (25-Jul-2026): set ReceivedWeightG when the
///     dispatch itself was partial. Mutually exclusive with ReceivedQty
///     (validator enforces + DB CHECK).
///   • Only lines that DIFFER from dispatched need to be in the payload —
///     any line the FE omits stays "no discrepancy noted" (NULL in DB).
public record ReceiveRequest(
    IReadOnlyList<ReceiveItem>? Items
);

public record ReceiveItem(
    Guid Id,
    int? ReceivedQty,
    /// 25-Jul-2026: partial-weight receive correction. Mutually exclusive
    /// with ReceivedQty per line. Only for products with weight_unit
    /// IN ('g','kg') where the godown originally dispatched partial.
    decimal? ReceivedWeightG = null
);
