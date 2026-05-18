using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IAppSettingRepository
{
    Task<List<AppSetting>> ListAsync(CancellationToken ct = default);
    Task<AppSetting?> GetAsync(string key, CancellationToken ct = default);
    Task<bool> UpdateAsync(string key, string value, Guid userId, CancellationToken ct = default);
}
