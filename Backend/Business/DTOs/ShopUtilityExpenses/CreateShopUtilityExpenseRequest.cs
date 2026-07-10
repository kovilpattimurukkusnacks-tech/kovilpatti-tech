namespace KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;

/// <summary>
/// Log a new utility expense against the caller's own shop. `ShopId` is NOT
/// part of this request on purpose — the service always resolves it from
/// the current ShopUser's JWT claim, so a client can't log against a
/// different shop by forging the payload.
/// </summary>
public record CreateShopUtilityExpenseRequest(
    string   Category,
    decimal  Amount,
    string?  Note,
    DateOnly ExpenseDate);
