using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Categories;

namespace KovilpattiSnacks.Business.Validators.Categories;

public class CreateCategoryRequestValidator : AbstractValidator<CreateCategoryRequest>
{
    public CreateCategoryRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(50);
    }
}
