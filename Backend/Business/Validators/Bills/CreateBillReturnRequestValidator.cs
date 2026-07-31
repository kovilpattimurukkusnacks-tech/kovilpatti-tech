using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Bills;

namespace KovilpattiSnacks.Business.Validators.Bills;

public class CreateBillReturnRequestValidator : AbstractValidator<CreateBillReturnRequest>
{
    private static readonly string[] RefundModes = ["Cash", "UPI"];
    private static readonly string[] ReasonTypes = ["Damaged", "WrongItem", "ChangedMind", "Other"];

    public CreateBillReturnRequestValidator()
    {
        RuleFor(x => x.SourceBillId).NotEmpty();

        RuleFor(x => x.RefundMode)
            .Must(m => RefundModes.Contains(m))
            .WithMessage("Refund mode must be Cash or UPI.");

        RuleFor(x => x.ReasonType)
            .Must(t => ReasonTypes.Contains(t))
            .WithMessage("Please choose a valid return reason.");

        RuleFor(x => x.ReasonNote)
            .MaximumLength(500).When(x => x.ReasonNote is not null);

        RuleFor(x => x.Items)
            .NotEmpty().WithMessage("A return must contain at least one item.")
            .Must(items => items.Select(i => i.ProductId).Distinct().Count() == items.Count)
            .WithMessage("The same product appears twice — combine the quantity on one line.");

        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.ProductId).NotEmpty();
            item.RuleFor(i => i.Qty).GreaterThan(0).WithMessage("Return quantity must be at least 1.");
        });
    }
}
