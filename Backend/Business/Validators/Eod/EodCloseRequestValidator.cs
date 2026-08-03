using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Eod;

namespace KovilpattiSnacks.Business.Validators.Eod;

public class EodCloseRequestValidator : AbstractValidator<EodCloseRequest>
{
    private static readonly int[] AllowedDenominations =
        { 500, 200, 100, 50, 20, 10, 5, 2, 1 };

    public EodCloseRequestValidator()
    {
        RuleFor(x => x)
            .Must(x => x.WindowFrom < x.WindowTo)
            .WithMessage("Close window must span forward in time.");

        RuleFor(x => x.Denominations)
            .NotNull()
            .Must(d => d.Count > 0)
            .WithMessage("At least one denomination row is required (use 0 counts for missing notes).");

        RuleForEach(x => x.Denominations).ChildRules(d =>
        {
            d.RuleFor(r => r.Denomination)
                .Must(v => AllowedDenominations.Contains(v))
                .WithMessage("Denomination must be one of 500, 200, 100, 50, 20, 10, 5, 2, 1.");
            d.RuleFor(r => r.Count)
                .GreaterThanOrEqualTo(0)
                .WithMessage("Denomination count cannot be negative.");
        });

        RuleFor(x => x.Denominations)
            .Must(d => d.Select(r => r.Denomination).Distinct().Count() == d.Count)
            .When(x => x.Denominations is { Count: > 0 })
            .WithMessage("The same denomination appears twice — combine into one row.");

        RuleFor(x => x.Notes)
            .MaximumLength(500).When(x => x.Notes is not null);
    }
}
