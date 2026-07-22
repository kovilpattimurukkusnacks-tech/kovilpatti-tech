using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Validators.StaffSalaries;

public class SetStaffSalaryRequestValidator : AbstractValidator<SetStaffSalaryRequest>
{
    public SetStaffSalaryRequestValidator()
    {
        RuleFor(x => x.StaffId).NotEmpty();
        // Upper bound matches the DB column's numeric(10,2) capacity — without
        // this, an over-limit amount surfaces as an unhandled 500 (Postgres
        // numeric field overflow) instead of a clean validation error.
        RuleFor(x => x.MonthlyAmount).GreaterThan(0).LessThanOrEqualTo(99_999_999.99m)
            .WithMessage("Monthly salary must be ₹99,999,999.99 or less.");
        RuleFor(x => x.EffectiveFrom).NotEqual(default(DateOnly))
            .WithMessage("Effective from date is required.");
    }
}
