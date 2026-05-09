using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Validators.Products;

public class CreateProductRequestValidator : AbstractValidator<CreateProductRequest>
{
    public CreateProductRequestValidator()
    {
        RuleFor(x => x.Code).MaximumLength(20);
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.CategoryId).GreaterThan(0);
        RuleFor(x => x.Type).NotEmpty().MaximumLength(20);
        RuleFor(x => x.WeightValue).GreaterThan(0).When(x => x.WeightValue.HasValue);
        RuleFor(x => x.WeightUnit)
            .Must(u => u is null or "g" or "kg")
            .WithMessage("WeightUnit must be 'g' or 'kg'.");
        RuleFor(x => x.Mrp).GreaterThanOrEqualTo(0);
        RuleFor(x => x.PurchasePrice).GreaterThanOrEqualTo(0);
    }
}
