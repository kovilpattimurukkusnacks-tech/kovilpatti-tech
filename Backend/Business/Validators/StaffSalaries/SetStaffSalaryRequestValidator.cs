using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Validators.StaffSalaries;

public class SetStaffSalaryRequestValidator : AbstractValidator<SetStaffSalaryRequest>
{
    public SetStaffSalaryRequestValidator()
    {
        RuleFor(x => x.StaffId).NotEmpty();
        RuleFor(x => x.MonthlyAmount).GreaterThan(0);
        RuleFor(x => x.EffectiveFrom).NotEqual(default(DateOnly))
            .WithMessage("Effective from date is required.");
    }
}
