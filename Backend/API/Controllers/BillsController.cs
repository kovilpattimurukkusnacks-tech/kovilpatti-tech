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

    // ───────── Bill returns (feature #1) ─────────

    /// Per-line returnable quantities for a bill — powers the return dialog.
    [HttpGet("{id:guid}/returnable")]
    public async Task<ActionResult<IReadOnlyList<ReturnableItemDto>>> Returnable(
        Guid id, CancellationToken ct)
        => Ok(await billService.ReturnableItemsAsync(id, ct));

    [HttpPost("returns")]
    public async Task<ActionResult<BillReturnCreatedDto>> CreateReturn(
        [FromBody] CreateBillReturnRequest request, CancellationToken ct)
    {
        var created = await billService.CreateReturnAsync(request, ct);
        return CreatedAtAction(nameof(GetReturn), new { id = created.Id }, created);
    }

    [HttpGet("returns")]
    public async Task<ActionResult<PagedResult<BillReturnListItemDto>>> ListReturns(
        [FromQuery] string? search, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 10, CancellationToken ct = default)
        => Ok(await billService.ListReturnsAsync(search, from, to, page, pageSize, ct));

    [HttpGet("returns/{id:guid}")]
    public async Task<ActionResult<BillReturnDetailDto>> GetReturn(Guid id, CancellationToken ct)
        => Ok(await billService.GetReturnAsync(id, ct));

    // ───────── Held (draft) bills (feature #3) ─────────

    [HttpPost("holds")]
    public async Task<ActionResult<HeldBillCreatedDto>> Hold(
        [FromBody] CreateHoldRequest request, CancellationToken ct)
        => Ok(await billService.HoldAsync(request, ct));

    [HttpGet("holds")]
    public async Task<ActionResult<IReadOnlyList<HeldBillListItemDto>>> ListHolds(CancellationToken ct)
        => Ok(await billService.ListHoldsAsync(ct));

    [HttpGet("holds/{id:guid}")]
    public async Task<ActionResult<HeldBillDetailDto>> GetHold(Guid id, CancellationToken ct)
        => Ok(await billService.GetHoldAsync(id, ct));

    [HttpDelete("holds/{id:guid}")]
    public async Task<IActionResult> DeleteHold(Guid id, CancellationToken ct)
    {
        await billService.DeleteHoldAsync(id, ct);
        return NoContent();
    }
}
