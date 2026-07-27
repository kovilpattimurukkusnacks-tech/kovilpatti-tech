using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Validators.StockRequests;

// Base validator for stock-request payloads (create + update + save-draft all
// share the same shape and constraints). Subclasses below close the generic.
public abstract class StockRequestPayloadValidator<T> : AbstractValidator<T>
    where T : IStockRequestPayload
{
    protected StockRequestPayloadValidator()
    {
        RuleFor(x => x.Notes).MaximumLength(500);

        RuleFor(x => x.Items)
            .NotNull()
            .Must(items => items != null && items.Count > 0)
            .WithMessage("Request must include at least one item.");

        // DB has UNIQUE(request_id, product_id) — catch duplicates here so the
        // user gets a clean message instead of a cryptic Postgres constraint error.
        RuleFor(x => x.Items)
            .Must(items => items == null
                || items.Select(i => i.ProductId).Distinct().Count() == items.Count)
            .WithMessage("Each product can only appear once in a request.");

        RuleForEach(x => x.Items).SetValidator(new CreateStockRequestItemValidator());
    }
}

public class CreateStockRequestRequestValidator : StockRequestPayloadValidator<CreateStockRequestRequest> { }
public class UpdateStockRequestRequestValidator : StockRequestPayloadValidator<UpdateStockRequestRequest> { }

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
            // Nullable — the save-dispatch-draft endpoint accepts null to
            // clear a persisted draft. The final /dispatch endpoint's
            // service method rejects null explicitly (see DispatchAsync)
            // so the terminal state can never be reached with an unset qty.
            item.RuleFor(i => i.DispatchedQty)
                .GreaterThanOrEqualTo(0)
                .When(i => i.DispatchedQty.HasValue);

            // 25-Jul-2026: partial-weight dispatch is opt-in via a positive
            // grams value. Mutually exclusive with DispatchedQty per line
            // (DB CHECK enforces at the storage layer; validator surfaces
            // the friendlier "pick one" error before the SP call).
            item.RuleFor(i => i.DispatchedWeightG)
                .GreaterThan(0)
                .When(i => i.DispatchedWeightG.HasValue)
                .WithMessage("Dispatched weight must be greater than 0 g.");

            item.RuleFor(i => i)
                .Must(i => !(i.DispatchedQty.HasValue && i.DispatchedWeightG.HasValue))
                .WithMessage("A line can dispatch either packet count or partial weight, not both.");
        });
    }
}

public class ReceiveRequestValidator : AbstractValidator<ReceiveRequest>
{
    public ReceiveRequestValidator()
    {
        // Items list is optional — omit / null / empty for the "receive all
        // as-dispatched" fast path. Only validate items when the shop sent
        // discrepancies.
        When(x => x.Items != null && x.Items.Count > 0, () =>
        {
            RuleForEach(x => x.Items).ChildRules(item =>
            {
                item.RuleFor(i => i.Id).NotEqual(Guid.Empty);
                item.RuleFor(i => i.ReceivedQty)
                    .GreaterThanOrEqualTo(0)
                    .When(i => i.ReceivedQty.HasValue);
                // 25-Jul-2026: partial-weight receive correction — same
                // XOR rule as dispatch. At least one of {qty, weight_g}
                // must be non-null (otherwise the row is empty noise).
                item.RuleFor(i => i.ReceivedWeightG)
                    .GreaterThan(0)
                    .When(i => i.ReceivedWeightG.HasValue)
                    .WithMessage("Received weight must be greater than 0 g.");

                item.RuleFor(i => i)
                    .Must(i => !(i.ReceivedQty.HasValue && i.ReceivedWeightG.HasValue))
                    .WithMessage("A line can report either packet count or partial weight, not both.");
                item.RuleFor(i => i)
                    .Must(i => i.ReceivedQty.HasValue || i.ReceivedWeightG.HasValue)
                    .WithMessage("Each receive line must report either packet count or partial weight.");
            });
        });
    }
}
