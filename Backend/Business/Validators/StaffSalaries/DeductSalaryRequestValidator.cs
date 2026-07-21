using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Validators.StaffSalaries;

public class DeductSalaryRequestValidator : AbstractValidator<DeductSalaryRequest>
{
    public DeductSalaryRequestValidator()
    {
        RuleFor(x => x.StaffId).NotEmpty();
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(50);
        RuleFor(x => x.TxnDate).NotEqual(default(DateOnly))
            .WithMessage("Deduction date is required.");
        RuleFor(x => x.Note).MaximumLength(500);
    }
}
