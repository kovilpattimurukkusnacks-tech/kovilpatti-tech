using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;

namespace KovilpattiSnacks.Business.Validators.StaffSalaries;

public class PaySalaryRequestValidator : AbstractValidator<PaySalaryRequest>
{
    public PaySalaryRequestValidator()
    {
        RuleFor(x => x.StaffId).NotEmpty();
        // Upper bound matches the DB column's numeric(10,2) capacity — without
        // this, an over-limit amount surfaces as an unhandled 500 (Postgres
        // numeric field overflow) instead of a clean validation error.
        RuleFor(x => x.Amount).GreaterThan(0).LessThanOrEqualTo(99_999_999.99m)
            .WithMessage("Amount must be ₹99,999,999.99 or less.");
        RuleFor(x => x.Mode).NotEmpty().MaximumLength(30);
        RuleFor(x => x.TxnDate).NotEqual(default(DateOnly))
            .WithMessage("Payment date is required.");
        RuleFor(x => x.Note).MaximumLength(500);
    }
}
