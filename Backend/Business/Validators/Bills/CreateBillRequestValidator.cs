using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Bills;

namespace KovilpattiSnacks.Business.Validators.Bills;

public class CreateBillRequestValidator : AbstractValidator<CreateBillRequest>
{
    private static readonly string[] PaymentModes = ["Cash", "UPI"];

    public CreateBillRequestValidator()
    {
        RuleFor(x => x.PaymentMode)
            .Must(m => PaymentModes.Contains(m))
            .WithMessage("Payment mode must be Cash or UPI.");

        RuleFor(x => x.Items)
            .NotEmpty().WithMessage("Bill must contain at least one item.")
            .Must(items => items.Select(i => i.ProductId).Distinct().Count() == items.Count)
            .WithMessage("The same product appears twice — adjust the quantity on one line instead.");

        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.ProductId).NotEmpty();
            item.RuleFor(i => i.Qty).GreaterThan(0).WithMessage("Quantity must be at least 1.");
        });

        RuleFor(x => x.Notes)
            .MaximumLength(500).When(x => x.Notes is not null);
    }
}

public class CancelBillRequestValidator : AbstractValidator<CancelBillRequest>
{
    public CancelBillRequestValidator()
    {
        RuleFor(x => x.Reason)
            .NotEmpty().WithMessage("A cancellation reason is required.")
            .MaximumLength(500);
    }
}
