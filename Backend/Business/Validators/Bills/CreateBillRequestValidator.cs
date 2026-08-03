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
            // 01-Aug-2026 (Phase 4c): each line is EITHER a packet Qty OR a
            // LooseWeightG (grams). SP rechecks sold_loose against the
            // product; here we only enforce the XOR shape + range.
            item.RuleFor(i => i)
                .Must(i => (i.Qty is not null) ^ (i.LooseWeightG is not null))
                .WithMessage("Each item must have either a Qty (packets) OR a LooseWeightG (grams), not both.");
            item.RuleFor(i => i.Qty!.Value)
                .GreaterThan(0)
                .When(i => i.Qty is not null)
                .WithMessage("Quantity must be at least 1.");
            item.RuleFor(i => i.LooseWeightG!.Value)
                .GreaterThan(0)
                .When(i => i.LooseWeightG is not null)
                .WithMessage("Loose weight must be greater than zero.");
        });

        RuleFor(x => x.Notes)
            .MaximumLength(500).When(x => x.Notes is not null);

        // Discount rules — kind + value move together. Percent is bounded
        // 0..100, Amount is a non-negative flat ₹ off (capped to subtotal
        // inside the SP so we don't need to know subtotal here).
        RuleFor(x => x)
            .Must(x => (x.DiscountKind is null) == (x.DiscountValue is null))
            .WithMessage("Discount kind and value must both be set or both be empty.");
        RuleFor(x => x.DiscountKind!)
            .Must(k => k is "Percent" or "Amount")
            .When(x => x.DiscountKind is not null)
            .WithMessage("Discount kind must be Percent or Amount.");
        RuleFor(x => x.DiscountValue!.Value)
            .InclusiveBetween(0, 100)
            .When(x => x.DiscountKind == "Percent")
            .WithMessage("Percent discount must be between 0 and 100.");
        RuleFor(x => x.DiscountValue!.Value)
            .GreaterThanOrEqualTo(0)
            .When(x => x.DiscountKind == "Amount")
            .WithMessage("Amount discount cannot be negative.");
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
