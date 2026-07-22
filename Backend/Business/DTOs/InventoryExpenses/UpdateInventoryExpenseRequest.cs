namespace KovilpattiSnacks.Business.DTOs.InventoryExpenses;

public record UpdateInventoryExpenseRequest(
    string   Category,
    decimal  Amount,
    string?  Note,
    DateOnly ExpenseDate);
