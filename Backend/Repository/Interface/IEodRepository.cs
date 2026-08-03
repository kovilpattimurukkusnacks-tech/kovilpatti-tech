using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IEodRepository
{
    Task<EodExpected> ExpectedAsync(Guid shopId, DateTimeOffset from, DateTimeOffset to, CancellationToken ct = default);
    Task<DateTimeOffset?> LastCloseAtAsync(Guid shopId, CancellationToken ct = default);
    Task<Guid> CloseAsync(
        Guid shopId, Guid userId,
        DateTimeOffset windowFrom, DateTimeOffset windowTo,
        string denominationsJson, string? notes,
        CancellationToken ct = default);
    Task<List<CashSessionListRow>> ListAsync(Guid shopId, int limit, CancellationToken ct = default);
}
