namespace KovilpattiSnacks.Business.DTOs.Settings;

public record AppSettingDto(
    string Key,
    string Value,
    string? Description,
    DateTimeOffset UpdatedAt,
    Guid? UpdatedBy);

public record UpdateAppSettingRequest(string Value);
