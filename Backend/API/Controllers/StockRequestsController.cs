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
        // Comma-separated request UUIDs; empty / omitted = aggregate every
        // Approved request in scope (legacy behaviour). Powers the FE's
        // "select which requests to cumulate" dialog (02-Jul-2026).
        [FromQuery] string? requestIds,
        CancellationToken ct)
    {
        IReadOnlyList<Guid>? ids = null;
        if (!string.IsNullOrWhiteSpace(requestIds))
        {
            ids = requestIds
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => Guid.TryParse(s, out var g) ? g : (Guid?)null)
                .Where(g => g.HasValue)
                .Select(g => g!.Value)
                .ToList();
        }
        return Ok(await requests.GetPendingCumulativeAsync(inventoryId, ids, ct));
    }

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

    // ─── Create (shop user for own shop, admin for any shop) ───
    // 08-Jul-2026: admin allowed too. Service enforces the role split:
    //   • Admin caller     → REQUIRES request.ShopId (creates for that shop).
    //   • ShopUser caller  → ignores/rejects request.ShopId, uses own claim.
    [HttpPost]
    [Authorize(Roles = "ShopUser,Admin")]
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
    // Body is optional — omit / empty for the one-click "as-dispatched"
    // confirm. Pass ReceiveRequest.Items to record per-item discrepancy
    // (shop counted less/more than what was dispatched).
    [HttpPatch("{id:guid}/receive")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> Receive(
        Guid id,
        [FromBody] ReceiveRequest? request,
        CancellationToken ct)
        => Ok(await requests.ReceiveAsync(id, request, ct));

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

    // 08-Jul-2026: draft endpoints now serve Admin too. Admin passes
    // `shopId` (path they're drafting for); shop users omit it and get
    // their own shop's draft via the auth claim. Service enforces the
    // role-based shop resolution; controller just forwards the query
    // param through.
    [HttpGet("draft")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> GetDraft(
        [FromQuery] Guid? shopId,
        CancellationToken ct)
    {
        var draft = await requests.GetShopDraftAsync(shopId, ct);
        return draft is null ? NotFound() : Ok(draft);
    }

    [HttpPost("draft")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> SaveDraft(
        [FromBody] CreateStockRequestRequest request,
        CancellationToken ct)
        => Ok(await requests.SaveShopDraftAsync(request, ct));

    [HttpDelete("draft")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<IActionResult> DeleteDraft(
        [FromQuery] Guid? shopId,
        CancellationToken ct)
    {
        await requests.DeleteShopDraftAsync(shopId, ct);
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

    // ─── Pin / unpin dispatch draft (Inventory + Admin) ───────
    // Pinned drafts sort to the top of the resume strip. Pass {pinned:true}
    // to pin, {pinned:false} to unpin. Re-pinning bumps the timestamp.
    [HttpPatch("{id:guid}/dispatch-draft-pin")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> PinDispatchDraft(
        Guid id,
        [FromBody] PinDispatchDraftRequest request,
        CancellationToken ct)
        => Ok(await requests.PinDispatchDraftAsync(id, request, ct));

    // ─── Inventory adds items (Inventory + Admin) ─────────────
    // Appends new product lines to a Pending or Approved request. Each row
    // is inserted with added_by = 'Inventory' so downstream views can
    // badge them "(inv)". Rejects duplicates — use the dispatch-qty flow
    // to send more of a shop-included product. (01-Jul-2026 client req.)
    [HttpPatch("{id:guid}/inventory-add-items")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> InventoryAddItems(
        Guid id,
        [FromBody] InventoryAddItemsRequest request,
        CancellationToken ct)
        => Ok(await requests.InventoryAddItemsAsync(id, request, ct));

    // ─── Inventory removes an inv-added item (Inventory + Admin) ─
    // Removes ONLY items the godown appended. Shop-added items are
    // protected server-side — use dispatch_qty = 0 to skip a shop item.
    [HttpDelete("{id:guid}/inventory-items/{itemId:guid}")]
    [Authorize(Roles = "Inventory,Admin")]
    public async Task<ActionResult<StockRequestDto>> InventoryRemoveItem(
        Guid id,
        Guid itemId,
        CancellationToken ct)
        => Ok(await requests.InventoryRemoveItemAsync(id, itemId, ct));

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

    // ─── Special Request (06-Jul-2026) ────────────────────────
    // Shop toggles the "special / vendor procurement" flag on a Pending
    // request. Admin allowed too; Inventory forbidden. Once approved the
    // flag freezes (SP-side gate).
    [HttpPatch("{id:guid}/special")]
    [Authorize(Roles = "ShopUser,Admin")]
    public async Task<ActionResult<StockRequestDto>> SetSpecial(
        Guid id,
        [FromBody] SetSpecialRequest request,
        CancellationToken ct)
        => Ok(await requests.SetSpecialAsync(id, request, ct));

    // Every un-received Special request in the caller's scope. Powers the
    // sticky top banner on shop / inv / admin. Never date-filtered. Role
    // scoping (own shop / own inv / tenant-wide) is service-side.
    [HttpGet("active-specials")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<ActiveSpecialDto>>> ActiveSpecials(
        CancellationToken ct)
        => Ok(await requests.ListActiveSpecialsAsync(ct));

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
