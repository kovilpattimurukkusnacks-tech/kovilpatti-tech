using FluentValidation;
using KovilpattiSnacks.Business.DTOs.VendorPurchases;

namespace KovilpattiSnacks.Business.Validators.VendorPurchases;

public class CreateVendorPurchaseItemValidator : AbstractValidator<CreateVendorPurchaseItem>
{
    public CreateVendorPurchaseItemValidator()
    {
        RuleFor(x => x.ProductId).NotEqual(Guid.Empty).WithMessage("ProductId is required.");
        RuleFor(x => x.Qty).GreaterThan(0).WithMessage("Qty must be greater than zero.");
        RuleFor(x => x.UnitCost).GreaterThanOrEqualTo(0).WithMessage("UnitCost cannot be negative.");
    }
}

public class CreateVendorPurchaseRequestValidator : AbstractValidator<CreateVendorPurchaseRequest>
{
    public CreateVendorPurchaseRequestValidator()
    {
        RuleFor(x => x.VendorId).NotEqual(Guid.Empty).WithMessage("VendorId is required.");
        RuleFor(x => x.GodownId).NotEqual(Guid.Empty).WithMessage("GodownId is required.");
        RuleFor(x => x.InvoiceNumber).NotEmpty().MaximumLength(60);
        RuleFor(x => x.InvoiceAmount).GreaterThanOrEqualTo(0).WithMessage("InvoiceAmount cannot be negative.");
        RuleFor(x => x.Notes).MaximumLength(500);

        RuleFor(x => x.Items).NotNull().Must(items => items.Count > 0)
            .WithMessage("Vendor purchase must include at least one item.");
        RuleFor(x => x.Items)
            .Must(items => items.Select(i => i.ProductId).Distinct().Count() == items.Count)
            .When(x => x.Items is { Count: > 0 })
            .WithMessage("Each product can only appear once per purchase.");
        RuleForEach(x => x.Items).SetValidator(new CreateVendorPurchaseItemValidator());
    }
}
