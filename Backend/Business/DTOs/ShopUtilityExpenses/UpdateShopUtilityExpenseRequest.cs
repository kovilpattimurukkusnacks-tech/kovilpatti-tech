namespace KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;

public record UpdateShopUtilityExpenseRequest(
    string   Category,
    decimal  Amount,
    string?  Note,
    DateOnly ExpenseDate);
