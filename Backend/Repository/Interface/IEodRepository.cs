using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IEodRepository
{
    Task<EodExpected> ExpectedAsync(Guid shopId, DateTimeOffset from, DateTimeOffset to, CancellationToken ct = default);
    /// Start of the next close window (fn_eod_window_from).
    Task<DateTimeOffset> WindowFromAsync(Guid shopId, CancellationToken ct = default);
    /// Window is computed server-side: [WindowFromAsync, now).
    Task<Guid> CloseAsync(
        Guid shopId, Guid userId, string denominationsJson, string? notes,
        CancellationToken ct = default);
    Task<List<CashSessionListRow>> ListAsync(Guid shopId, int limit, CancellationToken ct = default);
}
