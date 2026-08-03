namespace KovilpattiSnacks.Business.DTOs.Eod;

/// GET /api/eod/expected — the tender snapshot for a proposed close window.
public record EodExpectedDto(
    DateTimeOffset WindowFrom,
    DateTimeOffset WindowTo,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales,
    decimal CashRefunds,
    decimal UpiRefunds,
    decimal CancelCashBack,
    /// = CashSales − CashRefunds − CancelCashBack. What the till should hold.
    decimal ExpectedCash,
    long BillCount,
    long ReturnCount,
    long CancelCount
);

/// One denomination line on a close request.
public record EodDenominationInput(int Denomination, int Count);

/// POST /api/eod/close — cashier submits denominations for the window.
/// `WindowFrom` is client-supplied so the server can trust the range the
/// cashier saw. The BE re-computes expected totals inside the transaction
/// so a stale FE cache can't hide a variance.
public record EodCloseRequest(
    DateTimeOffset WindowFrom,
    DateTimeOffset WindowTo,
    IReadOnlyList<EodDenominationInput> Denominations,
    string? Notes
);

/// One row in the "recent close-outs" list.
public record EodSessionListItemDto(
    Guid Id,
    DateTimeOffset WindowFrom,
    DateTimeOffset ClosedAt,
    string? ClosedByName,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales,
    decimal CashRefunds,
    decimal UpiRefunds,
    decimal CancelCashBack,
    decimal ExpectedCash,
    decimal PhysicalCash,
    /// physical − expected. Positive = surplus, negative = shortage.
    decimal Variance,
    string? Notes
);
