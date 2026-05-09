using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Inventories;

namespace KovilpattiSnacks.Business.Validators.Inventories;

public class CreateInventoryRequestValidator : AbstractValidator<CreateInventoryRequest>
{
    public CreateInventoryRequestValidator()
    {
        RuleFor(x => x.Code).MaximumLength(20);
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Address).NotEmpty().MaximumLength(250);
        RuleFor(x => x.ContactPhone).NotEmpty().MaximumLength(20);
        RuleFor(x => x.ContactPersonName).MaximumLength(120);
    }
}
