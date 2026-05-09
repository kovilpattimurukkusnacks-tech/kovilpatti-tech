using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Auth;

namespace KovilpattiSnacks.Business.Validators.Auth;

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Username).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(255);
    }
}
