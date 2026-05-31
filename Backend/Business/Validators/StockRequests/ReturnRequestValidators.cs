using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Validators.StockRequests;

/// <summary>
/// Same shape as CreateStockRequestRequestValidator — inherits the shared
/// payload base (≥1 item, no duplicate ProductIds, notes ≤ 500, per-item
/// rules). SourceRequestId is optional and doesn't need a validator rule —
/// `null` is a legitimate "free-form return" choice.
/// </summary>
public class CreateReturnRequestValidator : StockRequestPayloadValidator<CreateReturnRequest> { }

public class AcceptReturnRequestValidator : AbstractValidator<AcceptReturnRequest>
{
    public AcceptReturnRequestValidator()
    {
        RuleFor(x => x.Items).NotNull();
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.Id).NotEqual(Guid.Empty);
            item.RuleFor(i => i.AcceptedQty).GreaterThanOrEqualTo(0);
        });
    }
}
