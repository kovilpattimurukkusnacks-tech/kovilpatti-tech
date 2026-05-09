using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Users;

namespace KovilpattiSnacks.Business.Validators.Users;

public class UpdateStaffRequestValidator : AbstractValidator<UpdateStaffRequest>
{
    private static readonly string[] AllowedRoles = { "ShopUser", "Inventory" };

    public UpdateStaffRequestValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(120);

        RuleFor(x => x.Role)
            .NotEmpty()
            .Must(r => AllowedRoles.Contains(r))
            .WithMessage("Role must be 'ShopUser' or 'Inventory'.");

        RuleFor(x => x).Custom((req, ctx) =>
        {
            if (req.Role == "ShopUser")
            {
                if (!req.ShopId.HasValue || req.ShopId == Guid.Empty)
                    ctx.AddFailure(nameof(req.ShopId), "ShopId is required for ShopUser role.");
                if (req.InventoryId.HasValue)
                    ctx.AddFailure(nameof(req.InventoryId), "InventoryId must be null for ShopUser role.");
            }
            else if (req.Role == "Inventory")
            {
                if (!req.InventoryId.HasValue || req.InventoryId == Guid.Empty)
                    ctx.AddFailure(nameof(req.InventoryId), "InventoryId is required for Inventory role.");
                if (req.ShopId.HasValue)
                    ctx.AddFailure(nameof(req.ShopId), "ShopId must be null for Inventory role.");
            }
        });
    }
}
