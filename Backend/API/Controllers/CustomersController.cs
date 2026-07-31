using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Customers;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 4b — customers + credit (features #6 + #4). ShopUser only; every
/// endpoint is scoped to the caller's own shop server-side.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.ShopUser)]
[Route("api/customers")]
public class CustomersController(ICustomerService customers) : ControllerBase
{
    /// Phone lookup for the POS header. 200 with null body when not found.
    [HttpGet("lookup")]
    public async Task<ActionResult<CustomerDto?>> Lookup([FromQuery] string phone, CancellationToken ct)
        => Ok(await customers.LookupAsync(phone, ct));

    [HttpPost]
    public async Task<ActionResult<CustomerDto>> Create(
        [FromBody] CreateCustomerRequest request, CancellationToken ct)
        => Ok(await customers.CreateAsync(request, ct));

    [HttpGet]
    public async Task<ActionResult<PagedResult<CustomerDto>>> List(
        [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
        => Ok(await customers.ListAsync(search, page, pageSize, ct));

    /// Record a repayment against a customer's credit balance. Returns the new balance.
    [HttpPost("{id:guid}/settle")]
    public async Task<ActionResult<decimal>> Settle(
        Guid id, [FromBody] SettleCreditRequest request, CancellationToken ct)
        => Ok(await customers.SettleAsync(id, request, ct));

    [HttpGet("{id:guid}/ledger")]
    public async Task<ActionResult<PagedResult<CustomerLedgerEntryDto>>> Ledger(
        Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
        => Ok(await customers.LedgerAsync(id, page, pageSize, ct));
}
