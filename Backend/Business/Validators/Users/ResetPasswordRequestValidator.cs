using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Users;

namespace KovilpattiSnacks.Business.Validators.Users;

public class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(x => x.NewPassword)
            .NotEmpty().MinimumLength(6).MaximumLength(255);
    }
}
