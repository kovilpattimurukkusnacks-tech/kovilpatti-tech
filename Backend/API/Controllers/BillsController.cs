using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Bills;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 4 — POS billing. ShopUser only; every endpoint is scoped to the
/// caller's own shop server-side (see BillService) — no cross-shop or
/// admin view in this slice.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.ShopUser)]
[Route("api/bills")]
public class BillsController(IBillService billService) : ControllerBase
{
    /// Product grid + scan lookup source for the billing screen.
    [HttpGet("products")]
    public async Task<ActionResult<IReadOnlyList<BillingProductDto>>> Products(
        [FromQuery] string? search, CancellationToken ct)
        => Ok(await billService.BillingProductsAsync(search, ct));

    [HttpPost]
    public async Task<ActionResult<BillCreatedDto>> Create(
        [FromBody] CreateBillRequest request, CancellationToken ct)
    {
        var created = await billService.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<BillListItemDto>>> List(
        [FromQuery] string? search, [FromQuery] string? status,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 10,
        CancellationToken ct = default)
        => Ok(await billService.ListAsync(search, status, from, to, page, pageSize, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<BillDetailDto>> Get(Guid id, CancellationToken ct)
        => Ok(await billService.GetAsync(id, ct));

    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(
        Guid id, [FromBody] CancelBillRequest request, CancellationToken ct)
    {
        await billService.CancelAsync(id, request, ct);
        return NoContent();
    }
}
