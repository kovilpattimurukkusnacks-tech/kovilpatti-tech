using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Vendors;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

// Vendor master is Admin-only end to end (design doc §7 recommendation —
// matches the financial-authority boundary used for other master data).
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/vendors")]
public class VendorsController(IVendorService vendors) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<VendorDto>>> List(CancellationToken ct)
        => Ok(await vendors.ListAsync(ct));

    [HttpGet("paged")]
    public async Task<ActionResult<PagedResult<VendorDto>>> ListPaged(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null,
        [FromQuery] bool? active = null,
        CancellationToken ct = default)
        => Ok(await vendors.ListPagedAsync(page, pageSize, search, active, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<VendorDto>> Get(Guid id, CancellationToken ct)
        => Ok(await vendors.GetAsync(id, ct));

    [HttpPost]
    public async Task<ActionResult<VendorDto>> Create([FromBody] CreateVendorRequest request, CancellationToken ct)
    {
        var dto = await vendors.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<VendorDto>> Update(Guid id, [FromBody] UpdateVendorRequest request, CancellationToken ct)
        => Ok(await vendors.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await vendors.DeleteAsync(id, ct);
        return NoContent();
    }
}
