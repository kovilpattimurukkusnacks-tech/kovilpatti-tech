using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Vendors;

namespace KovilpattiSnacks.Business.Validators.Vendors;

public class CreateVendorRequestValidator : AbstractValidator<CreateVendorRequest>
{
    public CreateVendorRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        // GST law (Section 24, CGST Act): any interstate supply requires GST
        // registration — no turnover-based exemption like intrastate has.
        RuleFor(x => x.Gstin)
            .NotEmpty().WithMessage("GSTIN is required for vendors outside Tamil Nadu (interstate supply must be GST-registered).")
            .When(x => !string.IsNullOrWhiteSpace(x.StateCode) && x.StateCode != "33");
        RuleFor(x => x.Gstin)
            .Length(15).When(x => !string.IsNullOrWhiteSpace(x.Gstin))
            .WithMessage("GSTIN must be exactly 15 characters when provided.");
        RuleFor(x => x.StateCode).NotEmpty().Length(2)
            .WithMessage("StateCode must be the 2-digit GST state code (e.g. '33' for Tamil Nadu).");
        RuleFor(x => x.Address).MaximumLength(250);
        RuleFor(x => x.ContactPerson).MaximumLength(120);
        RuleFor(x => x.ContactPhone).MaximumLength(20);
        RuleFor(x => x.Email).MaximumLength(120).EmailAddress()
            .When(x => !string.IsNullOrWhiteSpace(x.Email));
    }
}
