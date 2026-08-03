using KovilpattiSnacks.Business.DTOs.Eod;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// Phase 4c — End-of-day close-out. Shop-user scope only; admin has no
/// billing surface and therefore no EOD surface. Shop is resolved from the
/// authenticated user's claim, never passed via URL.
[ApiController]
[Authorize(Roles = "ShopUser")]
[Route("api/eod")]
public class EodController(IEodService eod) : ControllerBase
{
    /// GET /api/eod/expected — the tender snapshot for a proposed window.
    /// Both `from` and `to` are optional; when omitted, the service defaults
    /// to [last close closed_at OR IST midnight, now].
    [HttpGet("expected")]
    public async Task<ActionResult<EodExpectedDto>> Expected(
        [FromQuery] DateTimeOffset? from,
        [FromQuery] DateTimeOffset? to,
        CancellationToken ct)
        => Ok(await eod.ExpectedAsync(from, to, ct));

    /// POST /api/eod/close — persists the count + variance for the window.
    /// Returns { id } of the new cash_sessions row.
    [HttpPost("close")]
    public async Task<ActionResult<object>> Close(
        [FromBody] EodCloseRequest request,
        CancellationToken ct)
    {
        var id = await eod.CloseAsync(request, ct);
        return Ok(new { id });
    }

    /// GET /api/eod/recent — recent close-outs for the shop (default 10).
    [HttpGet("recent")]
    public async Task<ActionResult<IReadOnlyList<EodSessionListItemDto>>> Recent(
        [FromQuery] int limit = 10,
        CancellationToken ct = default)
        => Ok(await eod.RecentAsync(limit, ct));
}
