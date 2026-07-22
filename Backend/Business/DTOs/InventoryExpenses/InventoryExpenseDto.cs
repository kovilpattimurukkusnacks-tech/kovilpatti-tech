namespace KovilpattiSnacks.Business.DTOs.InventoryExpenses;

public record InventoryExpenseDto(
    Guid           Id,
    Guid           InventoryId,
    string         Category,
    decimal        Amount,
    string?        Note,
    DateOnly       ExpenseDate,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
