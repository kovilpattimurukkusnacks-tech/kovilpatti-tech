using System.Globalization;
using FluentValidation;
using FluentValidation.Results;
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
        ValidateNumericSetting(key, request.Value);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await settings.UpdateAsync(key, request.Value, userId, ct);
        if (!ok) throw new NotFoundException($"Setting '{key}' not found.");

        return await GetAsync(key, ct);
    }

    // 25-Sep-2026: the billing SPs cast these straight to numbers — a stray
    // "abc" would make every bill fail. Range-check the known numeric keys.
    private static readonly Dictionary<string, (decimal Min, decimal Max, bool WholeNumber, string Hint)> NumericKeys = new()
    {
        ["bill_max_discount_percent"]      = (0, 100, false, "a percentage from 0 to 100"),
        ["bill_return_window_days"]        = (0, 365, true,  "a whole number of days from 0 to 365"),
        ["held_bill_expiry_days"]          = (1, 30,  true,  "a whole number of days from 1 to 30"),
        ["customer_credit_limit_default"]  = (0, 10_000_000, false, "an amount of 0 or more (0 = no limit)"),
    };

    private static void ValidateNumericSetting(string key, string value)
    {
        if (!NumericKeys.TryGetValue(key, out var rule)) return;
        var ok = decimal.TryParse(value.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var n)
                 && n >= rule.Min && n <= rule.Max
                 && (!rule.WholeNumber || n == decimal.Truncate(n));
        if (!ok)
            throw new ValidationException(new[] { new ValidationFailure("value", $"Enter {rule.Hint}.") });
    }

    private static AppSettingDto MapToDto(AppSetting s)
        => new(s.Key, s.Value, s.Description, s.UpdatedAt, s.UpdatedBy);
}
