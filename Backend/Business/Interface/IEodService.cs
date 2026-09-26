using KovilpattiSnacks.Business.DTOs.Eod;

namespace KovilpattiSnacks.Business.Interface;

public interface IEodService
{
    /// Expected tender snapshot for the next close window — [previous close
    /// (or the shop's first billing activity), now). Called each time the FE
    /// opens the Close-day dialog so the numbers reflect bills issued right
    /// up to the moment the cashier is standing at the till. The window is
    /// server-decided (25-Sep-2026) — the close uses the same rule.
    Task<EodExpectedDto> ExpectedAsync(CancellationToken ct = default);

    /// Persist a close-out. Returns the new session id.
    Task<Guid> CloseAsync(EodCloseRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<EodSessionListItemDto>> RecentAsync(int limit, CancellationToken ct = default);
}
