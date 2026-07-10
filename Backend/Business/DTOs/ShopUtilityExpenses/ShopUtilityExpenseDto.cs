namespace KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;

public record ShopUtilityExpenseDto(
    Guid           Id,
    Guid           ShopId,
    string         Category,
    decimal        Amount,
    string?        Note,
    DateOnly       ExpenseDate,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
