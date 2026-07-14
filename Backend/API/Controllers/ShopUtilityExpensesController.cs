using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 4 — shop utility / operating expenses. ShopUser only; every
/// endpoint is scoped to the caller's own shop server-side (see
/// ShopUtilityExpenseService) — there is no cross-shop or admin view here.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.ShopUser)]
[Route("api/shop-utility-expenses")]
public class ShopUtilityExpensesController(IShopUtilityExpenseService expenses) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ShopUtilityExpenseDto>>> List(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await expenses.ListAsync(from, to, ct));

    [HttpPost]
    public async Task<ActionResult<ShopUtilityExpenseDto>> Create(
        [FromBody] CreateShopUtilityExpenseRequest request, CancellationToken ct)
    {
        var created = await expenses.CreateAsync(request, ct);
        return CreatedAtAction(nameof(List), created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ShopUtilityExpenseDto>> Update(
        Guid id, [FromBody] UpdateShopUtilityExpenseRequest request, CancellationToken ct)
        => Ok(await expenses.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await expenses.DeleteAsync(id, ct);
        return NoContent();
    }
}
