using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Shops;

namespace KovilpattiSnacks.Business.Validators.Shops;

public class CreateShopRequestValidator : AbstractValidator<CreateShopRequest>
{
    public CreateShopRequestValidator()
    {
        RuleFor(x => x.Code).MaximumLength(20);
        RuleFor(x => x.Name).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Address).NotEmpty().MaximumLength(250);
        RuleFor(x => x.ContactPhone1).NotEmpty().MaximumLength(20);
        RuleFor(x => x.ContactPhone2).MaximumLength(20);
        RuleFor(x => x.Gstin)
            .Length(15).When(x => !string.IsNullOrWhiteSpace(x.Gstin))
            .WithMessage("GSTIN must be exactly 15 characters when provided.");
        RuleFor(x => x.InventoryId).NotEqual(Guid.Empty)
            .WithMessage("InventoryId is required.");
    }
}
