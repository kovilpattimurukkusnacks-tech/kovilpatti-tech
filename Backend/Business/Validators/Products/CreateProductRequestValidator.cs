using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Validators.Products;

// Common rules for both Create + Update payloads. Subclasses below add any
// payload-specific rules (Create has Code; Update doesn't).
public abstract class ProductPayloadValidator<T> : AbstractValidator<T>
    where T : IProductPayload
{
    protected ProductPayloadValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.CategoryId).GreaterThan(0);
        RuleFor(x => x.Type).NotEmpty().MaximumLength(20);
        RuleFor(x => x.WeightValue).GreaterThan(0).When(x => x.WeightValue.HasValue);
        RuleFor(x => x.WeightUnit)
            .Must(u => u is null or "g" or "kg")
            .WithMessage("WeightUnit must be 'g' or 'kg'.");
        RuleFor(x => x.Mrp).GreaterThanOrEqualTo(0);
        RuleFor(x => x.PurchasePrice).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Gst).InclusiveBetween(0m, 100m).When(x => x.Gst.HasValue);
    }
}

public class CreateProductRequestValidator : ProductPayloadValidator<CreateProductRequest>
{
    public CreateProductRequestValidator()
    {
        // Only payload-specific rule. The 7 shared rules come from the base.
        RuleFor(x => x.Code).MaximumLength(20);
    }
}
