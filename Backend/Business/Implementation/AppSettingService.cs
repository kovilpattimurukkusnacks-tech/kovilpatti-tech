using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Settings;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class AppSettingService(
    IAppSettingRepository settings,
    ICurrentUser currentUser,
    IValidator<UpdateAppSettingRequest> updateValidator
) : IAppSettingService
{
    public async Task<IReadOnlyList<AppSettingDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await settings.ListAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<AppSettingDto> GetAsync(string key, CancellationToken ct = default)
    {
        var row = await settings.GetAsync(key, ct)
            ?? throw new NotFoundException($"Setting '{key}' not found.");
        return MapToDto(row);
    }

    public async Task<AppSettingDto> UpdateAsync(string key, UpdateAppSettingRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await settings.UpdateAsync(key, request.Value, userId, ct);
        if (!ok) throw new NotFoundException($"Setting '{key}' not found.");

        return await GetAsync(key, ct);
    }

    private static AppSettingDto MapToDto(AppSetting s)
        => new(s.Key, s.Value, s.Description, s.UpdatedAt, s.UpdatedBy);
}
