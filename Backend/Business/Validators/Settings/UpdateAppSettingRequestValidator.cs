using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Settings;

namespace KovilpattiSnacks.Business.Validators.Settings;

public class UpdateAppSettingRequestValidator : AbstractValidator<UpdateAppSettingRequest>
{
    public UpdateAppSettingRequestValidator()
    {
        RuleFor(x => x.Value).NotEmpty().MaximumLength(200);
    }
}
