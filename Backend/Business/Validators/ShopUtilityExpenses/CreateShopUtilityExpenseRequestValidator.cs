using FluentValidation;
using KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;

namespace KovilpattiSnacks.Business.Validators.ShopUtilityExpenses;

public class CreateShopUtilityExpenseRequestValidator : AbstractValidator<CreateShopUtilityExpenseRequest>
{
    public CreateShopUtilityExpenseRequestValidator()
    {
        RuleFor(x => x.Category).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Note).MaximumLength(500);
        RuleFor(x => x.ExpenseDate).NotEqual(default(DateOnly))
            .WithMessage("Expense date is required.");
    }
}
