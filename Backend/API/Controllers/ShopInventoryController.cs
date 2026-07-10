using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.ShopInventory;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// Shop inventory endpoints — on-hand list, drill-down, movements, low-stock,
/// valuation, admin manual adjustment. Stock-take flow also lives here since
/// it's the same domain object (session that writes Adjustment movements).
///
/// Auth pattern (enforced in the service layer):
///   • ShopUser → shop_id from claim, must match any passed shopId
///   • Admin    → passes shopId as query param
[ApiController]
[Authorize]
[Route("api/shop-inventory")]
public class ShopInventoryController(IShopInventoryService svc) : ControllerBase
{
    // ═══════════════ Inventory reads ═══════════════

    /// GET /api/shop-inventory?shopId=…&search=…&page=…&pageSize=…
    /// Shop user omits shopId; admin passes it.
    [HttpGet]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<PagedResult<ShopInventoryRowDto>>> ListOnHand(
        [FromQuery] Guid?   shopId,
        [FromQuery] string? search,
        [FromQuery] int     page     = 1,
        [FromQuery] int     pageSize = 25,
        CancellationToken ct = default)
        => Ok(await svc.ListOnHandAsync(shopId, search, page, pageSize, ct));

    [HttpGet("valuation")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<decimal>> Valuation(
        [FromQuery] Guid? shopId, CancellationToken ct)
        => Ok(await svc.ValuationAsync(shopId, ct));

    [HttpGet("low-stock")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<IReadOnlyList<ShopInventoryLowStockDto>>> LowStock(
        [FromQuery] Guid?    shopId,
        [FromQuery] decimal  threshold = 5m,
        CancellationToken ct = default)
        => Ok(await svc.LowStockAsync(shopId, threshold, ct));

    [HttpGet("{productId:guid}")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<ShopInventoryDetailDto>> GetOnHand(
        Guid productId,
        [FromQuery] Guid? shopId,
        CancellationToken ct = default)
        => Ok(await svc.GetOnHandAsync(shopId, productId, ct));

    [HttpGet("{productId:guid}/movements")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<IReadOnlyList<ShopInventoryMovementDto>>> ListMovementsForProduct(
        Guid productId,
        [FromQuery] Guid?    shopId,
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        [FromQuery] int      page     = 1,
        [FromQuery] int      pageSize = 50,
        CancellationToken ct = default)
        => Ok(await svc.ListMovementsAsync(shopId, productId, fromDate, toDate, page, pageSize, ct));

    /// GET /api/shop-inventory/movements — full ledger across all products,
    /// used by the dashboard "recent activity" widget when it wants a fuller
    /// history view than the pre-baked top-10 on the aggregate.
    [HttpGet("movements")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<IReadOnlyList<ShopInventoryMovementDto>>> ListMovements(
        [FromQuery] Guid?    shopId,
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        [FromQuery] int      page     = 1,
        [FromQuery] int      pageSize = 50,
        CancellationToken ct = default)
        => Ok(await svc.ListMovementsAsync(shopId, null, fromDate, toDate, page, pageSize, ct));

    // ═══════════════ Manual adjustment (Admin only) ═══════════════

    /// POST /api/shop-inventory/adjust?shopId=…
    /// Body: { productId, qtyDelta (signed), reason }
    /// Records a `ManualAdjustment` movement. Shop users go through the
    /// stock-take flow instead. Service layer enforces admin-only.
    [HttpPost("adjust")]
    [Authorize(Roles = RoleNames.Admin)]
    public async Task<ActionResult<ShopInventoryDetailDto>> Adjust(
        [FromQuery] Guid? shopId,
        [FromBody]  AdjustInventoryRequest request,
        CancellationToken ct = default)
        => Ok(await svc.AdjustAsync(shopId, request, ct));

    // ═══════════════ Stock-take flow ═══════════════

    /// POST /api/shop-inventory/stock-takes?shopId=…
    /// Starts a new Draft session; SP raises 409 if one already exists.
    [HttpPost("stock-takes")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<StockTakeDetailDto>> StartStockTake(
        [FromQuery] Guid? shopId, CancellationToken ct)
    {
        var dto = await svc.StartStockTakeAsync(shopId, ct);
        return CreatedAtAction(nameof(GetStockTake), new { id = dto.Id }, dto);
    }

    /// GET /api/shop-inventory/stock-takes/{id}
    [HttpGet("stock-takes/{id:guid}")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<StockTakeDetailDto>> GetStockTake(Guid id, CancellationToken ct)
        => Ok(await svc.GetStockTakeAsync(id, ct));

    /// GET /api/shop-inventory/stock-takes?shopId=…&status=Draft&…
    [HttpGet("stock-takes")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<PagedResult<StockTakeSummaryDto>>> ListStockTakes(
        [FromQuery] Guid?     shopId,
        [FromQuery] string?   status,
        [FromQuery] DateOnly? fromDate,
        [FromQuery] DateOnly? toDate,
        [FromQuery] int       page     = 1,
        [FromQuery] int       pageSize = 25,
        CancellationToken ct = default)
        => Ok(await svc.ListStockTakesAsync(shopId, status, fromDate, toDate, page, pageSize, ct));

    /// PUT /api/shop-inventory/stock-takes/{id}/lines
    /// Body: { productId, countedQty, note? }
    /// Save (or overwrite) one counted-qty line. Session must be Draft.
    [HttpPut("stock-takes/{id:guid}/lines")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<StockTakeDetailDto>> UpsertStockTakeLine(
        Guid id,
        [FromBody] UpsertStockTakeLineRequest request,
        CancellationToken ct = default)
        => Ok(await svc.UpsertStockTakeLineAsync(id, request, ct));

    /// POST /api/shop-inventory/stock-takes/{id}/submit
    /// Writes Adjustment movements for non-zero diffs; marks Submitted.
    [HttpPost("stock-takes/{id:guid}/submit")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<StockTakeDetailDto>> SubmitStockTake(
        Guid id, CancellationToken ct)
        => Ok(await svc.SubmitStockTakeAsync(id, ct));

    /// POST /api/shop-inventory/stock-takes/{id}/cancel
    /// Body: { reason }
    [HttpPost("stock-takes/{id:guid}/cancel")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<StockTakeDetailDto>> CancelStockTake(
        Guid id,
        [FromBody] CancelStockTakeRequest request,
        CancellationToken ct = default)
        => Ok(await svc.CancelStockTakeAsync(id, request, ct));
}
