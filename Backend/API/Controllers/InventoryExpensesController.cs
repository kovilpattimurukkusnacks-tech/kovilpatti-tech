using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.InventoryExpenses;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 4 — godown / inventory operating expenses (21-Jul-2026 client req).
/// Inventory user only; every endpoint is scoped to the caller's own
/// godown server-side (see InventoryExpenseService). Admin explicitly NOT
/// allowed to create / update / delete here — owner delegates entirely
/// to godown staff. Admin still reads the totals via the Accounts screen.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.Inventory)]
[Route("api/inventory-expenses")]
public class InventoryExpensesController(IInventoryExpenseService expenses) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<InventoryExpenseDto>>> List(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await expenses.ListAsync(from, to, ct));

    [HttpPost]
    public async Task<ActionResult<InventoryExpenseDto>> Create(
        [FromBody] CreateInventoryExpenseRequest request, CancellationToken ct)
    {
        var created = await expenses.CreateAsync(request, ct);
        return CreatedAtAction(nameof(List), created);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<InventoryExpenseDto>> Update(
        Guid id, [FromBody] UpdateInventoryExpenseRequest request, CancellationToken ct)
        => Ok(await expenses.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await expenses.DeleteAsync(id, ct);
        return NoContent();
    }
}
