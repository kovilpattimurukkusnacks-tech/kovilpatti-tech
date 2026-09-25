using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.AdminPos;
using KovilpattiSnacks.Business.DTOs.Customers;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 4d — admin-side POS views across all shops: bills, returns, day-end
/// closes, credit customers and sales reports. Read-only; shop-side writes
/// stay on BillsController / EodController / CustomersController.
/// shopId omitted = all shops. Dates are IST yyyy-MM-dd, inclusive.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.Admin)]
[Route("api/admin/pos")]
public class AdminPosController(IAdminPosService pos) : ControllerBase
{
    // ───────── Bills ─────────

    [HttpGet("bills")]
    public async Task<ActionResult<PagedResult<AdminBillListItemDto>>> Bills(
        [FromQuery] Guid? shopId, [FromQuery] string? search, [FromQuery] string? status,
        [FromQuery] string? paymentMode, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        => Ok(await pos.ListBillsAsync(shopId, search, status, paymentMode, from, to, page, pageSize, ct));

    [HttpGet("bills/{id:guid}")]
    public async Task<ActionResult<AdminBillDetailDto>> Bill(Guid id, CancellationToken ct)
        => Ok(await pos.GetBillAsync(id, ct));

    // ───────── Returns ─────────

    [HttpGet("returns")]
    public async Task<ActionResult<PagedResult<AdminBillReturnListItemDto>>> Returns(
        [FromQuery] Guid? shopId, [FromQuery] string? search,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        => Ok(await pos.ListReturnsAsync(shopId, search, from, to, page, pageSize, ct));

    [HttpGet("returns/{id:guid}")]
    public async Task<ActionResult<AdminBillReturnDetailDto>> Return(Guid id, CancellationToken ct)
        => Ok(await pos.GetReturnAsync(id, ct));

    // ───────── Day-end closes ─────────

    [HttpGet("eod")]
    public async Task<ActionResult<PagedResult<AdminEodSessionDto>>> Eod(
        [FromQuery] Guid? shopId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] bool varianceOnly = false,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        => Ok(await pos.ListEodAsync(shopId, from, to, varianceOnly, page, pageSize, ct));

    [HttpGet("eod/{id:guid}/denominations")]
    public async Task<ActionResult<IReadOnlyList<AdminEodDenominationDto>>> EodDenominations(
        Guid id, CancellationToken ct)
        => Ok(await pos.EodDenominationsAsync(id, ct));

    // ───────── Credit customers ─────────

    [HttpGet("customers")]
    public async Task<ActionResult<AdminCustomerPageDto>> Customers(
        [FromQuery] Guid? shopId, [FromQuery] string? search, [FromQuery] bool outstandingOnly = true,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        => Ok(await pos.ListCustomersAsync(shopId, search, outstandingOnly, page, pageSize, ct));

    [HttpGet("customers/{id:guid}/ledger")]
    public async Task<ActionResult<PagedResult<CustomerLedgerEntryDto>>> CustomerLedger(
        Guid id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
        => Ok(await pos.CustomerLedgerAsync(id, page, pageSize, ct));

    // ───────── Sales reports (from + to required, ≤ 366 days) ─────────

    [HttpGet("sales/summary")]
    public async Task<ActionResult<AdminSalesSummaryDto>> SalesSummary(
        [FromQuery] Guid? shopId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await pos.SalesSummaryAsync(shopId, from, to, ct));

    [HttpGet("sales/by-shop")]
    public async Task<ActionResult<IReadOnlyList<AdminSalesShopRowDto>>> SalesByShop(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await pos.SalesByShopAsync(from, to, ct));

    [HttpGet("sales/daily")]
    public async Task<ActionResult<IReadOnlyList<AdminSalesDayRowDto>>> SalesDaily(
        [FromQuery] Guid? shopId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
        => Ok(await pos.SalesDailyAsync(shopId, from, to, ct));

    [HttpGet("sales/top-products")]
    public async Task<ActionResult<IReadOnlyList<AdminSalesProductRowDto>>> SalesTopProducts(
        [FromQuery] Guid? shopId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int limit = 20, CancellationToken ct = default)
        => Ok(await pos.SalesTopProductsAsync(shopId, from, to, limit, ct));
}
