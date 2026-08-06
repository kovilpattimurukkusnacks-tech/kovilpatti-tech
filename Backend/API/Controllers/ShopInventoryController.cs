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

    /// GET /api/shop-inventory/tree?shopId=…
    /// Slim flat list (product + category_id + on_hand + mrp) for the
    /// dashboard's expandable category-tree browse view. No pagination —
    /// FE groups + rolls up on the client using /api/categories.
    [HttpGet("tree")]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<IReadOnlyList<ShopInventoryTreeItemDto>>> Tree(
        [FromQuery] Guid? shopId, CancellationToken ct)
        => Ok(await svc.ListForTreeAsync(shopId, ct));

    // ═══════════════ Manual adjustment (Admin only) ═══════════════

    /// POST /api/shop-inventory/adjust?shopId=…
    /// Body: { productId, qtyDelta (signed), reason }
    /// Records a `ManualAdjustment` movement. Admin only.
    [HttpPost("adjust")]
    [Authorize(Roles = RoleNames.Admin)]
    public async Task<ActionResult<ShopInventoryDetailDto>> Adjust(
        [FromQuery] Guid? shopId,
        [FromBody]  AdjustInventoryRequest request,
        CancellationToken ct = default)
        => Ok(await svc.AdjustAsync(shopId, request, ct));
}
