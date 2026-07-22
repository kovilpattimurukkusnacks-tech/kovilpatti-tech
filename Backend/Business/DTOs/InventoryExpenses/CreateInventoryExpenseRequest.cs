namespace KovilpattiSnacks.Business.DTOs.InventoryExpenses;

/// <summary>
/// Log a new expense against the caller's own inventory / godown.
/// `InventoryId` is NOT part of this request on purpose — the service
/// always resolves it from the current Inventory user's JWT claim, so
/// a client can't log against a different godown by forging the payload.
/// Admin users are explicitly forbidden per client spec (21-Jul-2026).
/// </summary>
public record CreateInventoryExpenseRequest(
    string   Category,
    decimal  Amount,
    string?  Note,
    DateOnly ExpenseDate);
