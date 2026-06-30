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
        [FromQuery] Guid?     shopId,
        [FromQuery] Guid?     inventoryId,
        [FromQuery] string?   status,
        [FromQuery] string?   search,
        [FromQuery] int       page        = 1,
        [FromQuery] int       pageSize    = 10,
        [FromQuery] DateOnly? fromDate    = null,
        [FromQuery] DateOnly? toDate      = null,
        [FromQuery] string?   requestType = null,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(shopId, inventoryId, status, search, page, pageSize, fromDate, toDate, requestType, ct));

    // ─── Shop user: own shop's requests ──────────────────────
    [HttpGet("mine")]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<PagedResult<StockRequestDto>>> ListMine(
        [FromQuery] string?   status,
        [FromQuery] string?   search,
        [FromQuery] int       page        = 1,
        [FromQuery] int       pageSize    = 10,
        [FromQuery] DateOnly? fromDate    = null,
        [FromQuery] DateOnly? toDate      = null,
        [FromQuery] string?   requestType = null,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(currentUser.ShopId, null, status, search, page, pageSize, fromDate, toDate, requestType, ct));

    // ─── Inventory user: requests for their godown ───────────
    // shopId is an optional drill-down filter from the per-shop chip row;
    // inventoryId is force-scoped to the caller's godown so this stays safe.
    [HttpGet("incoming")]
    [Authorize(Roles = "Inventory")]
    public async Task<ActionResult<PagedResult<StockRequestDto>>> ListIncoming(
        [FromQuery] Guid?     shopId,
        [FromQuery] string?   status,
        [FromQuery] string?   search,
        [FromQuery] int       page        = 1,
        [FromQuery] int       pageSize    = 10,
        [FromQuery] DateOnly? fromDate    = null,
        [FromQuery] DateOnly? toDate      = null,
        [FromQuery] string?   requestType = null,
        CancellationToken ct = default)
        => Ok(await requests.ListAsync(shopId, currentUser.InventoryId, status, search, page, pageSize, fromDate, toDate, requestType, ct));

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

    // ─── Per-shop request counts (Inventory + Admin) ─────────
    // Drives the list page's shop quick-filter chips. status=… mirrors the
    // currently-active status preset; omit for "All". Shops with 0 matching
    // requests are not returned (SP prunes them via INNER JOIN).
    [HttpGet("count-by-shop")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<IReadOnlyList<ShopRequestCountDto>>> CountByShop(
        [FromQuery] string?   status,
        [FromQuery] Guid?     inventoryId,
        [FromQuery] DateOnly? fromDate    = null,
        [FromQuery] DateOnly? toDate      = null,
        [FromQuery] string?   requestType = null,
        CancellationToken ct = default)
        => Ok(await requests.GetCountByShopAsync(status, inventoryId, fromDate, toDate, requestType, ct));

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

    // ─── Shop draft (single live draft per shop) ─────────────
    // ShopUser only. The shop_id is taken from the JWT — never trusted from
    // the URL — so a shop can only ever read/write its own draft. Drafts
    // are excluded from every list/count endpoint; this is the only way to
    // reach one.

    [HttpGet("draft")]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<StockRequestDto>> GetDraft(CancellationToken ct)
    {
        var draft = await requests.GetShopDraftAsync(ct);
        return draft is null ? NotFound() : Ok(draft);
    }

    [HttpPost("draft")]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<StockRequestDto>> SaveDraft(
        [FromBody] CreateStockRequestRequest request,
        CancellationToken ct)
        => Ok(await requests.SaveShopDraftAsync(request, ct));

    [HttpDelete("draft")]
    [Authorize(Roles = "ShopUser")]
    public async Task<IActionResult> DeleteDraft(CancellationToken ct)
    {
        await requests.DeleteShopDraftAsync(ct);
        return NoContent();
    }

    // ─── Dispatch draft (Inventory + Admin) ──────────────────
    // Saves WIP dispatch qtys to draft_dispatched_qty without flipping the
    // request status. Same payload shape as the finalising dispatch
    // endpoint above so the FE can call either depending on the button.
    [HttpPatch("{id:guid}/dispatch-draft")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> SaveDispatchDraft(
        Guid id,
        [FromBody] DispatchRequest request,
        CancellationToken ct)
        => Ok(await requests.SaveDispatchDraftAsync(id, request, ct));

    // ─── Discard dispatch draft (Inventory + Admin) ──────────
    // Clears draft_dispatched_qty on every item AND the draft_name label,
    // leaving the request itself in the same Pending/Approved state.
    [HttpDelete("{id:guid}/dispatch-draft")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> ClearDispatchDraft(
        Guid id,
        CancellationToken ct)
        => Ok(await requests.ClearDispatchDraftAsync(id, ct));

    // ─── Rename dispatch draft (Inventory + Admin) ───────────
    // Set or clear the godown's free-text label on a saved dispatch draft.
    // Empty / whitespace-only name in the body clears the label. Separate
    // endpoint from save-dispatch-draft so qty auto-saves and rename events
    // can't accidentally collide.
    [HttpPatch("{id:guid}/dispatch-draft-name")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> RenameDispatchDraft(
        Guid id,
        [FromBody] RenameDispatchDraftRequest request,
        CancellationToken ct)
        => Ok(await requests.RenameDispatchDraftAsync(id, request, ct));

    // ─── Return Stock ─────────────────────────────────────────
    // Shop user creates a Return (items back to godown). Optional
    // sourceRequestId links to the original Order so Phase 3 accounts
    // can reverse the exact ledger entry.
    [HttpPost("return")]
    [Authorize(Roles = "ShopUser")]
    public async Task<ActionResult<StockRequestDto>> CreateReturn(
        [FromBody] CreateReturnRequest request,
        CancellationToken ct)
    {
        var dto = await requests.CreateReturnAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    // Inventory user / Admin accepts a Pending Return → terminal "Accepted".
    // Per-item acceptedQty allowed for partial accepts (physical count
    // differs from what the shop claimed they were sending back).
    [HttpPatch("{id:guid}/accept")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> AcceptReturn(
        Guid id,
        [FromBody] AcceptReturnRequest request,
        CancellationToken ct)
        => Ok(await requests.AcceptReturnAsync(id, request, ct));

    // Admin amends an item's dispatched_qty AFTER the request has been
    // completed (Received Orders or Accepted Returns). Each edit is logged
    // to stock_request_qty_audits for Phase 3 accounts to reconcile.
    // Service-side also re-checks the Admin role so this can never be
    // called from a less-restrictive route by mistake.
    [HttpPatch("{id:guid}/items/{itemId:guid}/dispatched-qty")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<StockRequestDto>> EditDispatchedQty(
        Guid id,
        Guid itemId,
        [FromBody] EditDispatchedQtyRequest request,
        CancellationToken ct)
        => Ok(await requests.EditDispatchedQtyAsync(id, itemId, request, ct));

    // ─── Inventory dispatch drafts list (Inventory + Admin) ──
    // Returns Pending/Approved requests that have at least one item with a
    // saved dispatch draft. Drives the "Resume dispatch draft" strip on
    // the inventory list page.
    [HttpGet("dispatch-drafts")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<IReadOnlyList<StockRequestDto>>> ListDispatchDrafts(
        [FromQuery] Guid? inventoryId,
        CancellationToken ct)
        => Ok(await requests.ListInventoryDispatchDraftsAsync(inventoryId, ct));
}
