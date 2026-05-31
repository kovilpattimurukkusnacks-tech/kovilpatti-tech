using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StockRequests;

namespace KovilpattiSnacks.Business.Validators.StockRequests;

/// <summary>
/// Admin's post-completion qty correction. <c>NewQty</c> is nullable to
/// support clearing the value; when set, it must be non-negative (no upper
/// cap — matches the existing dispatch flow). <c>Reason</c> is optional but
/// length-bounded so a malicious admin can't dump megabytes into the audit
/// row's free-text column.
/// </summary>
public class EditDispatchedQtyRequestValidator : AbstractValidator<EditDispatchedQtyRequest>
{
    public EditDispatchedQtyRequestValidator()
    {
        RuleFor(x => x.NewQty)
            .GreaterThanOrEqualTo(0)
            .When(x => x.NewQty.HasValue)
            .WithMessage("New qty must be 0 or greater.");

        RuleFor(x => x.Reason)
            .MaximumLength(500)
            .WithMessage("Reason must be 500 characters or fewer.");
    }
}
