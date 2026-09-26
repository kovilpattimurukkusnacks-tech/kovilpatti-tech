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
    /// GET /api/eod/expected — the tender snapshot for the next close window.
    /// The window is server-decided: [previous close (or the shop's first
    /// billing activity), now] — the same range POST /close records.
    [HttpGet("expected")]
    public async Task<ActionResult<EodExpectedDto>> Expected(CancellationToken ct)
        => Ok(await eod.ExpectedAsync(ct));

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
