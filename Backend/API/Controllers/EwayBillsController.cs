using KovilpattiSnacks.Business.DTOs.EwayBills;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// Phase 5b — Inbound e-way bill CRUD, scoped under the parent vendor
/// purchase in the URL so the parent id can't be spoofed via the body. Admin
/// only (same authority boundary as VendorPurchasesController).
///
/// Outbound e-way (stock_requests / bills) will get its own controller when
/// Phase 4 wires that side — the shared table + entity are already in place.
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/vendor-purchases/{purchaseId:guid}/eway-bills")]
public class EwayBillsController(IEwayBillService eway) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<EwayBillDto>>> List(Guid purchaseId, CancellationToken ct)
        => Ok(await eway.ListForPurchaseAsync(purchaseId, ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<EwayBillDto>> Get(Guid purchaseId, Guid id, CancellationToken ct)
        => Ok(await eway.GetAsync(id, ct));

    [HttpPost]
    public async Task<ActionResult<EwayBillDto>> Record(
        Guid purchaseId,
        [FromBody] RecordEwayBillRequest request,
        CancellationToken ct)
    {
        var dto = await eway.RecordInboundAsync(purchaseId, request, ct);
        return CreatedAtAction(nameof(Get), new { purchaseId, id = dto.Id }, dto);
    }

    public record CancelBody(string? Reason);

    // POST — not DELETE — because "Cancel" is a state transition (row stays
    // in eway_bills with status='Cancelled' for audit history), not a delete.
    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(
        Guid purchaseId, Guid id,
        [FromBody] CancelBody? body,
        CancellationToken ct)
    {
        await eway.CancelAsync(id, body?.Reason, ct);
        return NoContent();
    }
}

/// Settings surface for the inbound threshold — exposed at the parent
/// vendor-purchases URL space so the FE can decide (before opening the
/// e-way section) whether the gate is active.
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/eway-bills")]
public class EwayBillsMetaController(IEwayBillService eway) : ControllerBase
{
    /// Returns `{ threshold }` in ₹. 0 = gate disabled.
    [HttpGet("threshold/inbound")]
    public async Task<ActionResult<object>> GetInboundThreshold(CancellationToken ct)
        => Ok(new { threshold = await eway.GetInboundThresholdAsync(ct) });
}
