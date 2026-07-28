using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Customers;

namespace KovilpattiSnacks.Business.Validators.Customers;

public class CreateCustomerRequestValidator : AbstractValidator<CreateCustomerRequest>
{
    public CreateCustomerRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Customer name is required.")
            .MaximumLength(120);

        RuleFor(x => x.Phone)
            .NotEmpty().WithMessage("Customer phone is required.")
            .Matches(@"^\d{10}$").WithMessage("Enter a valid 10-digit mobile number.");

        RuleFor(x => x.CreditLimit)
            .GreaterThanOrEqualTo(0).When(x => x.CreditLimit.HasValue)
            .WithMessage("Credit limit cannot be negative.");
    }
}

public class SettleCreditRequestValidator : AbstractValidator<SettleCreditRequest>
{
    private static readonly string[] Modes = ["Cash", "UPI"];

    public SettleCreditRequestValidator()
    {
        RuleFor(x => x.Amount)
            .GreaterThan(0).WithMessage("Settlement amount must be greater than zero.");

        RuleFor(x => x.Mode)
            .Must(m => Modes.Contains(m))
            .WithMessage("Settlement must be Cash or UPI.");

        RuleFor(x => x.Note)
            .MaximumLength(500).When(x => x.Note is not null);
    }
}
