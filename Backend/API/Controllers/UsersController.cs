using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Users;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/users")]
public class UsersController(IUserService users) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> List(CancellationToken ct)
        => Ok(await users.ListAsync(ct));

    [HttpGet("paged")]
    public async Task<ActionResult<PagedResult<UserDto>>> ListPaged(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken ct = default)
        => Ok(await users.ListPagedAsync(page, pageSize, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<UserDto>> Get(Guid id, CancellationToken ct)
        => Ok(await users.GetAsync(id, ct));

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create([FromBody] CreateStaffRequest request, CancellationToken ct)
    {
        var dto = await users.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<UserDto>> Update(Guid id, [FromBody] UpdateStaffRequest request, CancellationToken ct)
        => Ok(await users.UpdateAsync(id, request, ct));

    [HttpPut("{id:guid}/password")]
    public async Task<IActionResult> ResetPassword(Guid id, [FromBody] ResetPasswordRequest request, CancellationToken ct)
    {
        await users.ResetPasswordAsync(id, request, ct);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await users.DeleteAsync(id, ct);
        return NoContent();
    }
}
