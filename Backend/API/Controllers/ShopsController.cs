using KovilpattiSnacks.Business.DTOs.Shops;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]
[Route("api/shops")]
public class ShopsController(IShopService shops) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ShopDto>>> List(CancellationToken ct)
        => Ok(await shops.ListAsync(ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ShopDto>> Get(Guid id, CancellationToken ct)
        => Ok(await shops.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ShopDto>> Create([FromBody] CreateShopRequest request, CancellationToken ct)
    {
        var dto = await shops.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ShopDto>> Update(Guid id, [FromBody] UpdateShopRequest request, CancellationToken ct)
        => Ok(await shops.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await shops.DeleteAsync(id, ct);
        return NoContent();
    }
}
