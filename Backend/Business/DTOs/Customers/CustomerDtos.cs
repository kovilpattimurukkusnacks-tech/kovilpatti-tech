namespace KovilpattiSnacks.Business.DTOs.Customers;

// Phase 4b — customers + credit (features #6 + #4). Client term: "credit".

public record CustomerDto(
    Guid Id,
    string Code,
    string Name,
    string Phone,
    decimal CreditLimit,
    decimal CreditBalance);

public record CreateCustomerRequest(
    string Name,
    string Phone,
    decimal? CreditLimit);      // null ⇒ default from settings

public record SettleCreditRequest(
    decimal Amount,
    string Mode,                // 'Cash' | 'UPI'
    string? Note);

public record CustomerLedgerEntryDto(
    Guid Id,
    string EntryType,           // 'Credit' | 'Settlement'
    decimal Amount,
    string? Mode,
    string? Note,
    decimal BalanceAfter,
    string? BillCode,
    DateTime CreatedAt,
    string? CreatedByName);
