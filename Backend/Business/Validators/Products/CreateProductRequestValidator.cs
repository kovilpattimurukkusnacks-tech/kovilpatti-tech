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
            .Must(u => u is null or "g" or "kg" or "pcs" or "pkt")
            .WithMessage("WeightUnit must be 'g', 'kg', 'pcs', or 'pkt'.");
        RuleFor(x => x.Mrp).GreaterThanOrEqualTo(0);
        RuleFor(x => x.PurchasePrice).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Gst).InclusiveBetween(0m, 100m).When(x => x.Gst.HasValue);
    }
}

public class CreateProductRequestValidator : ProductPayloadValidator<CreateProductRequest>
{
    public CreateProductRequestValidator()
    {
        // Code is intentionally unbounded (07-Jun-2026, client #10) — admin
        // uses descriptive codes that exceed the original 20-char cap.
        // The 7 shared rules come from the base; no payload-specific ones.
    }
}
