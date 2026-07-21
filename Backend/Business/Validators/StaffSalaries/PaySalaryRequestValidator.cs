using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Validators.StaffSalaries;

public class PaySalaryRequestValidator : AbstractValidator<PaySalaryRequest>
{
    public PaySalaryRequestValidator()
    {
        RuleFor(x => x.StaffId).NotEmpty();
        RuleFor(x => x.Amount).GreaterThan(0);
        RuleFor(x => x.Mode).NotEmpty().MaximumLength(30);
        RuleFor(x => x.TxnDate).NotEqual(default(DateOnly))
            .WithMessage("Payment date is required.");
        RuleFor(x => x.Note).MaximumLength(500);
    }
}
