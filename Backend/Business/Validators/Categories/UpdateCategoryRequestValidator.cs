using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Categories;

namespace KovilpattiSnacks.Business.Validators.Categories;

public class UpdateCategoryRequestValidator : AbstractValidator<UpdateCategoryRequest>
{
    public UpdateCategoryRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(50);
    }
}
