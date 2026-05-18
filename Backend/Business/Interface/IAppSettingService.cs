using KovilpattiSnacks.Business.DTOs.Settings;

namespace KovilpattiSnacks.Business.Interface;

public interface IAppSettingService
{
    Task<IReadOnlyList<AppSettingDto>> ListAsync(CancellationToken ct = default);
    Task<AppSettingDto> GetAsync(string key, CancellationToken ct = default);
    Task<AppSettingDto> UpdateAsync(string key, UpdateAppSettingRequest request, CancellationToken ct = default);
}
