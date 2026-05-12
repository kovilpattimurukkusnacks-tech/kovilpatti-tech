using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Inventories;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]
[Route("api/inventories")]
public class InventoriesController(IInventoryService inventories) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<InventoryDto>>> List(CancellationToken ct)
        => Ok(await inventories.ListAsync(ct));

    [HttpGet("paged")]
    public async Task<ActionResult<PagedResult<InventoryDto>>> ListPaged(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken ct = default)
        => Ok(await inventories.ListPagedAsync(page, pageSize, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<InventoryDto>> Get(Guid id, CancellationToken ct)
        => Ok(await inventories.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<InventoryDto>> Create([FromBody] CreateInventoryRequest request, CancellationToken ct)
    {
        var dto = await inventories.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<InventoryDto>> Update(Guid id, [FromBody] UpdateInventoryRequest request, CancellationToken ct)
        => Ok(await inventories.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await inventories.DeleteAsync(id, ct);
        return NoContent();
    }
}
