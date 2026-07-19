using KovilpattiSnacks.Business.DTOs.Auth;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService auth) : ControllerBase
{
    // Rate limiting lives in AuthService — it counts only failed attempts
    // (not successes) so legit users never burn their own quota.
    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken ct)
        => Ok(await auth.LoginAsync(request, ct));

    // Silent session renewal — the client swaps a valid refresh token for a
    // fresh access token (+ rotated refresh token). Anonymous: it's the refresh
    // token itself that authenticates, not the (likely-expired) access token.
    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<ActionResult<LoginResponse>> Refresh([FromBody] RefreshRequest request, CancellationToken ct)
        => Ok(await auth.RefreshAsync(request, ct));

    // Revoke the refresh token server-side on logout. Anonymous + best-effort —
    // always 204 even if the token was already gone.
    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromBody] LogoutRequest request, CancellationToken ct)
    {
        await auth.LogoutAsync(request, ct);
        return NoContent();
    }
}
