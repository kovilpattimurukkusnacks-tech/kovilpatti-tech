using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Bills;

namespace KovilpattiSnacks.Business.Validators.Bills;

public class CreateBillRequestValidator : AbstractValidator<CreateBillRequest>
{
    private static readonly string[] PaymentModes = ["Cash", "UPI", "Credit"];

    public CreateBillRequestValidator()
    {
        RuleFor(x => x.Payments)
            .NotEmpty().WithMessage("Bill must have at least one payment.");

        // A credit tender must name the customer whose balance it lands on.
        RuleFor(x => x.CustomerId)
            .NotNull()
            .When(x => x.Payments is not null && x.Payments.Any(p => p.Mode == "Credit"))
            .WithMessage("A customer is required for a credit sale.");

        RuleForEach(x => x.Payments).ChildRules(pay =>
        {
            pay.RuleFor(p => p.Mode)
                .Must(m => PaymentModes.Contains(m))
                .WithMessage("Payment mode must be Cash or UPI.");
            pay.RuleFor(p => p.Amount)
                .GreaterThan(0).WithMessage("Each payment amount must be greater than zero.");
        });

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
    private static readonly string[] ReasonTypes =
        ["Mistake", "Duplicate", "CustomerRefused", "Other"];

    public CancelBillRequestValidator()
    {
        RuleFor(x => x.ReasonType)
            .Must(t => ReasonTypes.Contains(t))
            .WithMessage("Please choose a valid cancellation reason.");

        RuleFor(x => x.ReasonNote)
            .MaximumLength(500).When(x => x.ReasonNote is not null);
    }
}
