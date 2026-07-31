using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.VendorPurchases;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

// Admin-only end to end (design doc §1 — purchases carry invoice/GST/e-way
// compliance weight, same financial-authority boundary as Vendors).
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/vendor-purchases")]
public class VendorPurchasesController(IVendorPurchaseService purchases) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResult<VendorPurchaseDto>>> List(
        [FromQuery] Guid? vendorId = null,
        [FromQuery] Guid? godownId = null,
        [FromQuery] string? status = null,
        [FromQuery] bool? isInterstate = null,
        [FromQuery] DateOnly? fromDate = null,
        [FromQuery] DateOnly? toDate = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken ct = default)
        => Ok(await purchases.ListAsync(vendorId, godownId, status, isInterstate, fromDate, toDate, search, page, pageSize, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<VendorPurchaseDto>> Get(Guid id, CancellationToken ct)
        => Ok(await purchases.GetAsync(id, ct));

    [HttpPost]
    public async Task<ActionResult<VendorPurchaseDto>> Create([FromBody] CreateVendorPurchaseRequest request, CancellationToken ct)
    {
        var dto = await purchases.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<VendorPurchaseDto>> Update(Guid id, [FromBody] UpdateVendorPurchaseRequest request, CancellationToken ct)
        => Ok(await purchases.UpdateAsync(id, request, ct));

    [HttpPatch("{id:guid}/receive")]
    public async Task<ActionResult<VendorPurchaseDto>> Receive(Guid id, CancellationToken ct)
        => Ok(await purchases.ReceiveAsync(id, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
    {
        await purchases.CancelAsync(id, ct);
        return NoContent();
    }
}
