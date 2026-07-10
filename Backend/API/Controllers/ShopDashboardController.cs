using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.ShopInventory;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// Single aggregate endpoint powering the shop user's post-login dashboard
/// (see project_kovilpatti_shop_landing memory). Assembles ~5 phase-4 SPs +
/// phase-2 pending-request count into ONE payload — dashboard renders on a
/// single API call, no request waterfall.
[ApiController]
[Authorize]
[Route("api/shop-dashboard")]
public class ShopDashboardController(IShopDashboardService svc) : ControllerBase
{
    /// GET /api/shop-dashboard
    /// Shop user: omits shopId (their own claim is used).
    /// Admin: passes ?shopId=… to view a specific shop's dashboard.
    [HttpGet]
    [Authorize(Roles = RoleNames.ShopUser + "," + RoleNames.Admin)]
    public async Task<ActionResult<ShopDashboardDto>> Get(
        [FromQuery] Guid? shopId, CancellationToken ct)
        => Ok(await svc.GetAsync(shopId, ct));
}
