using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Accounts;

namespace KovilpattiSnacks.Business.Validators.Accounts;

/// <summary>
/// Validates the query-string filters that drive every Accounts endpoint.
/// From / To are required IST calendar dates with From ≤ To and a span
/// ≤ 366 days. Grouping (when present) is restricted to day/week/month;
/// Limit (when present) is restricted to {10, 25, 50}.
/// </summary>
public class AccountsFiltersValidator : AbstractValidator<AccountsFilters>
{
    private static readonly string[] AllowedGroupings = ["day", "week", "month"];
    private static readonly int[]    AllowedLimits    = [10, 25, 50];

    public AccountsFiltersValidator()
    {
        RuleFor(x => x.From)
            .NotNull()
            .WithMessage("From date is required (yyyy-MM-dd).");

        RuleFor(x => x.To)
            .NotNull()
            .WithMessage("To date is required (yyyy-MM-dd).");

        // Range inversion + span cap. Only fire when both ends are present so we
        // don't double up with the NotNull messages above.
        RuleFor(x => x)
            .Must(x => x.From!.Value <= x.To!.Value)
            .When(x => x.From.HasValue && x.To.HasValue)
            .WithName("range")
            .WithMessage("From date must be on or before To date.");

        RuleFor(x => x)
            .Must(x => (x.To!.Value.DayNumber - x.From!.Value.DayNumber) <= 366)
            .When(x => x.From.HasValue && x.To.HasValue && x.From.Value <= x.To.Value)
            .WithName("range")
            .WithMessage("Date range cannot exceed 366 days.");

        RuleFor(x => x.Grouping)
            .Must(g => g is null || AllowedGroupings.Contains(g))
            .WithMessage("Grouping must be one of: day, week, month.");

        RuleFor(x => x.Limit)
            .Must(n => n is null || AllowedLimits.Contains(n.Value))
            .WithMessage("Limit must be one of: 10, 25, 50.");
    }
}
