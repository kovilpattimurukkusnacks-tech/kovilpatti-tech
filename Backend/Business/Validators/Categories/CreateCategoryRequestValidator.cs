using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Categories;

namespace KovilpattiSnacks.Business.Validators.Categories;

public class CreateCategoryRequestValidator : AbstractValidator<CreateCategoryRequest>
{
    public CreateCategoryRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(50);
        // ParentId either null (root) or a positive int (existing category id).
        // Existence + cycle checks happen in the service layer.
        RuleFor(x => x.ParentId)
            .GreaterThan(0).When(x => x.ParentId.HasValue)
            .WithMessage("Parent must be a valid category id.");
    }
}
