using KovilpattiSnacks.Business.DTOs.Eod;

namespace KovilpattiSnacks.Business.Interface;

public interface IEodService
{
    /// Expected tender snapshot for a proposed close window. Called each
    /// time the FE opens the Close-day dialog so the numbers reflect
    /// bills issued right up to the moment the cashier is standing at the
    /// till.
    Task<EodExpectedDto> ExpectedAsync(DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct = default);

    /// Persist a close-out. Returns the new session id.
    Task<Guid> CloseAsync(EodCloseRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<EodSessionListItemDto>> RecentAsync(int limit, CancellationToken ct = default);
}
