using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.StockRequests;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]
[Route("api/stock-requests")]
public class StockRequestsController(IStockRequestService requests, ICurrentUser currentUser) : ControllerBase
{
    // ─── Admin: all requests ─────────────────────────────────
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<PagedResult<StockRequestDto>>> List(
        [FromQuery] Guid?   shopId,
        [FromQuery] Guid?   inventoryId,
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int     page     = 1,
        [FromQuery] int     pageSize = 10,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(shopId, inventoryId, status, search, page, pageSize, ct));

    // ─── Shop user: own shop's requests ──────────────────────
    [HttpGet("mine")]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<PagedResult<StockRequestDto>>> ListMine(
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int     page     = 1,
        [FromQuery] int     pageSize = 10,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(currentUser.ShopId, null, status, search, page, pageSize, ct));

    // ─── Inventory user: requests for their godown ───────────
    [HttpGet("incoming")]
    [Authorize(Roles = "Inventory")]
    public async Task<ActionResult<PagedResult<StockRequestDto>>> ListIncoming(
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] int     page     = 1,
        [FromQuery] int     pageSize = 10,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(null, currentUser.InventoryId, status, search, page, pageSize, ct));

    // ─── Cumulative pending workload (Inventory + Admin) ─────
    // Aggregate of every Pending request's items, grouped by SKU. Inventory
    // user always sees their own godown; admin may pass ?inventoryId=… or
    // omit it for tenant-wide totals. Shop users blocked at the service layer.
    [HttpGet("print/cumulative")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<IReadOnlyList<CumulativePendingLineDto>>> Cumulative(
        [FromQuery] Guid? inventoryId,
        CancellationToken ct)
        => Ok(await requests.GetPendingCumulativeAsync(inventoryId, ct));

    // ─── Detail (any role — service enforces ownership) ──────
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<StockRequestDto>> Get(Guid id, CancellationToken ct)
        => Ok(await requests.GetAsync(id, ct));

    // ─── Shop user: create ───────────────────────────────────
    [HttpPost]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<StockRequestDto>> Create([FromBody] CreateStockRequestRequest request, CancellationToken ct)
    {
        var dto = await requests.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    // ─── Edit (shop user before lock, admin anytime) ─────────
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> Update(Guid id, [FromBody] UpdateStockRequestRequest request, CancellationToken ct)
        => Ok(await requests.UpdateAsync(id, request, ct));

    // ─── Approve (Inventory + Admin) ─────────────────────────
    // Inventory user can approve a Pending request routed to their godown;
    // admin can approve any. Service enforces scoping.
    [HttpPatch("{id:guid}/approve")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> Approve(Guid id, CancellationToken ct)
        => Ok(await requests.ApproveAsync(id, ct));

    // ─── Reject (Inventory + Admin, reason required) ─────────
    [HttpPatch("{id:guid}/reject")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> Reject(Guid id, [FromBody] RejectRequest request, CancellationToken ct)
        => Ok(await requests.RejectAsync(id, request, ct));

    // ─── Revoke (Inventory + Admin) ──────────────────────────
    // Reverses an earlier Approve or Reject and flips status back to Pending.
    // Blocked once the request has been dispatched.
    [HttpPatch("{id:guid}/revoke")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> Revoke(Guid id, CancellationToken ct)
        => Ok(await requests.RevokeAsync(id, ct));

    // ─── Inventory user: dispatch ────────────────────────────
    [HttpPatch("{id:guid}/dispatch")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> Dispatch(Guid id, [FromBody] DispatchRequest request, CancellationToken ct)
        => Ok(await requests.DispatchAsync(id, request, ct));

    // ─── Shop user: confirm receipt ──────────────────────────
    [HttpPatch("{id:guid}/receive")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> Receive(Guid id, CancellationToken ct)
        => Ok(await requests.ReceiveAsync(id, ct));

    // ─── Cancel (shop before lock, admin anytime) ────────────
    [HttpPatch("{id:guid}/cancel")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> Cancel(Guid id, CancellationToken ct)
        => Ok(await requests.CancelAsync(id, ct));
}
