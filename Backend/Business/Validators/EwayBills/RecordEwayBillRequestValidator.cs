using FluentValidation;
using KovilpattiSnacks.Business.DTOs.EwayBills;

namespace KovilpattiSnacks.Business.Validators.EwayBills;

public class RecordEwayBillRequestValidator : AbstractValidator<RecordEwayBillRequest>
{
    public RecordEwayBillRequestValidator()
    {
        // GST portal e-way numbers are 12 digits, but we accept up to 20 chars
        // to allow for future portal changes / test numbers with prefixes.
        RuleFor(x => x.EwayNumber)
            .NotEmpty().WithMessage("E-way bill number is required.")
            .MaximumLength(20)
            .Matches("^[0-9A-Za-z-]+$").WithMessage("E-way number: digits, letters, and dashes only.");

        RuleFor(x => x.DocumentNumber).MaximumLength(40);
        RuleFor(x => x.FromGstin).Length(15).When(x => !string.IsNullOrEmpty(x.FromGstin))
            .WithMessage("GSTIN must be 15 characters.");
        RuleFor(x => x.ToGstin).Length(15).When(x => !string.IsNullOrEmpty(x.ToGstin))
            .WithMessage("GSTIN must be 15 characters.");
        RuleFor(x => x.FromStateCode).Length(2).When(x => !string.IsNullOrEmpty(x.FromStateCode));
        RuleFor(x => x.ToStateCode).Length(2).When(x => !string.IsNullOrEmpty(x.ToStateCode));

        RuleFor(x => x.TransportMode)
            .Must(m => m is null || m is "Road" or "Rail" or "Air" or "Ship")
            .WithMessage("Transport mode must be Road, Rail, Air, or Ship.");

        RuleFor(x => x.DistanceKm).GreaterThanOrEqualTo(0).When(x => x.DistanceKm.HasValue);

        RuleFor(x => x.TransporterName).MaximumLength(120);
        RuleFor(x => x.VehicleNumber).MaximumLength(20);
        RuleFor(x => x.AttachmentUrl).MaximumLength(500);
        // Notes uses text at the DB level — no length cap; leave FE-side.

        // XOR: interstate purchases carry IGST; intrastate carries CGST+SGST.
        // Never both (SP has chk_eway_bills_tax_exclusive as the last resort).
        RuleFor(x => x)
            .Must(x => !(x.IgstAmount is > 0 && (x.CgstAmount is > 0 || x.SgstAmount is > 0)))
            .WithMessage("IGST cannot coexist with CGST/SGST — choose one tax split.");

        // Amounts non-negative when provided.
        RuleFor(x => x.TaxableAmount).GreaterThanOrEqualTo(0).When(x => x.TaxableAmount.HasValue);
        RuleFor(x => x.CgstAmount).GreaterThanOrEqualTo(0).When(x => x.CgstAmount.HasValue);
        RuleFor(x => x.SgstAmount).GreaterThanOrEqualTo(0).When(x => x.SgstAmount.HasValue);
        RuleFor(x => x.IgstAmount).GreaterThanOrEqualTo(0).When(x => x.IgstAmount.HasValue);
        RuleFor(x => x.TotalAmount).GreaterThanOrEqualTo(0).When(x => x.TotalAmount.HasValue);
    }
}
