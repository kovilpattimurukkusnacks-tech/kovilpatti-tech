namespace KovilpattiSnacks.Business.DTOs.Eod;

/// GET /api/eod/expected — the tender snapshot for the next close window.
public record EodExpectedDto(
    DateTimeOffset WindowFrom,
    DateTimeOffset WindowTo,
    decimal CashSales,
    decimal UpiSales,
    decimal CreditSales,
    decimal CashRefunds,
    decimal UpiRefunds,
    decimal CancelCashBack,
    /// UPI handed back on cancelled bills (informational — not in the till).
    decimal CancelUpiBack,
    /// Udhaar (credit) repaid in cash — this cash IS in the till.
    decimal CashSettlements,
    decimal UpiSettlements,
    /// = CashSales + CashSettlements − CashRefunds − CancelCashBack.
    /// What the till should hold.
    decimal ExpectedCash,
    long BillCount,
    long ReturnCount,
    long CancelCount
);

/// One denomination line on a close request.
public record EodDenominationInput(int Denomination, int Count);

/// POST /api/eod/close — cashier submits denominations.
/// 25-Sep-2026: the close window is decided by the server (previous close →
/// now). WindowFrom / WindowTo are still accepted so older front-ends keep
/// working, but they are ignored.
public record EodCloseRequest(
    DateTimeOffset? WindowFrom,
    DateTimeOffset? WindowTo,
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
    decimal CancelUpiBack,
    decimal CashSettlements,
    decimal UpiSettlements,
    decimal ExpectedCash,
    decimal PhysicalCash,
    /// physical − expected. Positive = surplus, negative = shortage.
    decimal Variance,
    string? Notes
);
