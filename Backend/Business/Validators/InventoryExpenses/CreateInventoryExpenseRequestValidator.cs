using FluentValidation;
using KovilpattiSnacks.Business.DTOs.InventoryExpenses;

namespace KovilpattiSnacks.Business.Validators.InventoryExpenses;

public class CreateInventoryExpenseRequestValidator : AbstractValidator<CreateInventoryExpenseRequest>
{
    public CreateInventoryExpenseRequestValidator()
    {
        RuleFor(x => x.Category).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Note).MaximumLength(500);
        RuleFor(x => x.ExpenseDate).NotEqual(default(DateOnly))
            .WithMessage("Expense date is required.");
    }
}
