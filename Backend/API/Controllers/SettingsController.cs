using KovilpattiSnacks.Business.DTOs.Settings;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]   // List + Get readable by any authenticated role — FE needs the
              // request_lock_enabled flag to gate the "Locked — admin only"
              // chip on the shop request detail page. Write (Update) is still
              // admin-only via the explicit attribute below.
[Route("api/settings")]
public class SettingsController(IAppSettingService settings) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AppSettingDto>>> List(CancellationToken ct)
        => Ok(await settings.ListAsync(ct));

    [HttpGet("{key}")]
    public async Task<ActionResult<AppSettingDto>> Get(string key, CancellationToken ct)
        => Ok(await settings.GetAsync(key, ct));

    [HttpPut("{key}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<AppSettingDto>> Update(string key, [FromBody] UpdateAppSettingRequest request, CancellationToken ct)
        => Ok(await settings.UpdateAsync(key, request, ct));
}
