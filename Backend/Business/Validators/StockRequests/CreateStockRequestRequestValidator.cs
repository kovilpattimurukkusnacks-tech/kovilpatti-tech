using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Validators.StockRequests;

public class CreateStockRequestRequestValidator : AbstractValidator<CreateStockRequestRequest>
{
    public CreateStockRequestRequestValidator()
    {
        RuleFor(x => x.Notes).MaximumLength(500);
        RuleFor(x => x.Items)
            .NotNull()
            .Must(items => items != null && items.Count > 0)
            .WithMessage("Request must include at least one item.");
        RuleForEach(x => x.Items).SetValidator(new CreateStockRequestItemValidator());
    }
}

public class UpdateStockRequestRequestValidator : AbstractValidator<UpdateStockRequestRequest>
{
    public UpdateStockRequestRequestValidator()
    {
        RuleFor(x => x.Notes).MaximumLength(500);
        RuleFor(x => x.Items)
            .NotNull()
            .Must(items => items != null && items.Count > 0)
            .WithMessage("Request must include at least one item.");
        RuleForEach(x => x.Items).SetValidator(new CreateStockRequestItemValidator());
    }
}

public class CreateStockRequestItemValidator : AbstractValidator<CreateStockRequestItem>
{
    public CreateStockRequestItemValidator()
    {
        RuleFor(x => x.ProductId).NotEqual(Guid.Empty);
        RuleFor(x => x.RequestedQty).GreaterThan(0).LessThanOrEqualTo(100_000);
    }
}

public class RejectRequestValidator : AbstractValidator<RejectRequest>
{
    public RejectRequestValidator()
    {
        RuleFor(x => x.Reason).NotEmpty().MaximumLength(500);
    }
}

public class DispatchRequestValidator : AbstractValidator<DispatchRequest>
{
    public DispatchRequestValidator()
    {
        RuleFor(x => x.Items).NotNull();
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.Id).NotEqual(Guid.Empty);
            item.RuleFor(i => i.DispatchedQty).GreaterThanOrEqualTo(0);
        });
    }
}
