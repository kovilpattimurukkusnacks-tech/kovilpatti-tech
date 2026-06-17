using System.Globalization;
using KovilpattiSnacks.Business.DTOs.Accounts;
using KovilpattiSnacks.Business.Implementation;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Phase 3 read-only accounts reporting. Admin-only. Every endpoint accepts
/// the same <see cref="AccountsFilters"/> query string (from/to required,
/// rest optional). Service layer validates and re-checks the role.
///
/// Export endpoints stream a native .xlsx workbook (client #11, 13-Jun-2026
/// — replaces the prior CSV-with-BOM approach). Amounts, counts and
/// timestamps are written as Excel-native types so the workbook is sortable
/// / summable / pivot-table-able without further format work.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/accounts")]
public class AccountsController(IAccountsService accounts) : ControllerBase
{
    // ──────── JSON endpoints ────────

    [HttpGet("summary")]
    public async Task<ActionResult<AccountsSummaryDto>> Summary([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetSummaryAsync(filters, ct));

    [HttpGet("trend")]
    public async Task<ActionResult<IReadOnlyList<AccountsTrendBucketDto>>> Trend([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetTrendAsync(filters, ct));

    [HttpGet("by-shop")]
    public async Task<ActionResult<IReadOnlyList<AccountsShopRowDto>>> ByShop([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetByShopAsync(filters, ct));

    [HttpGet("by-category")]
    public async Task<ActionResult<IReadOnlyList<AccountsCategoryRowDto>>> ByCategory([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetByCategoryAsync(filters, ct));

    [HttpGet("top-products")]
    public async Task<ActionResult<IReadOnlyList<AccountsProductRowDto>>> TopProducts([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetTopProductsAsync(filters, ct));

    [HttpGet("adjustments")]
    public async Task<ActionResult<IReadOnlyList<AccountsAdjustmentRowDto>>> Adjustments([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetAdjustmentsAsync(filters, ct));

    [HttpGet("in-transit")]
    public async Task<ActionResult<AccountsInTransitDto>> InTransit([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetInTransitAsync(filters, ct));

    // ──────── XLSX export endpoints ────────
    //
    // Each export passes the raw typed value (decimal / long / DateTimeOffset
    // / string) to the writer and tells it the desired Excel format. Composite
    // columns (e.g. "100 g") stay as strings since they're not a single
    // primitive.

    [HttpGet("export/by-shop")]
    public async Task<IActionResult> ExportByShop([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetByShopAsync(filters, ct);
        var cols = new List<AccountsXlsxWriter.Column<AccountsShopRowDto>>
        {
            new("Shop Code",            r => r.ShopCode),
            new("Shop Name",            r => r.ShopName),
            new("Order Requests",       r => r.OrderRequestCount,  AccountsXlsxWriter.ColumnFormat.Integer),
            new("Return Requests",      r => r.ReturnRequestCount, AccountsXlsxWriter.ColumnFormat.Integer),
            new("Requested Qty",        r => r.RequestedQty,       AccountsXlsxWriter.ColumnFormat.Integer),
            new("Dispatched Qty",       r => r.DispatchedQty,      AccountsXlsxWriter.ColumnFormat.Integer),
            new("Returned Qty",         r => r.ReturnedQty,        AccountsXlsxWriter.ColumnFormat.Integer),
            new("Requested (MRP)",      r => r.RequestedAmount,    AccountsXlsxWriter.ColumnFormat.Currency),
            new("Dispatched (MRP)",     r => r.DispatchedAmount,   AccountsXlsxWriter.ColumnFormat.Currency),
            new("Returns (MRP)",        r => r.ReturnsAmount,      AccountsXlsxWriter.ColumnFormat.Currency),
            new("Adjustments (MRP)",    r => r.AdjustmentsAmount,  AccountsXlsxWriter.ColumnFormat.Currency),
            new("Net (MRP)",            r => r.NetAmount,          AccountsXlsxWriter.ColumnFormat.Currency),
            // 17-Jun-2026 (client #12): cost-side columns after Net.
            // Profit / Loss are mutually exclusive — exactly one is non-zero
            // per row (Indian P&L pair convention).
            new("Purchase Amount",      r => r.PurchaseAmount,     AccountsXlsxWriter.ColumnFormat.Currency),
            new("Profit",               r => r.Profit,             AccountsXlsxWriter.ColumnFormat.Currency),
            new("Loss",                 r => r.Loss,               AccountsXlsxWriter.ColumnFormat.Currency),
        };
        return XlsxResult("by-shop", filters, rows, cols);
    }

    [HttpGet("export/by-category")]
    public async Task<IActionResult> ExportByCategory([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetByCategoryAsync(filters, ct);
        var cols = new List<AccountsXlsxWriter.Column<AccountsCategoryRowDto>>
        {
            new("Category Path",   r => r.CategoryPath),
            new("Quantity",        r => r.Quantity, AccountsXlsxWriter.ColumnFormat.Integer),
            new("Amount (MRP)",    r => r.Amount,   AccountsXlsxWriter.ColumnFormat.Currency),
            // 17-Jun-2026 (client #12): cost-side columns after Amount.
            // Profit / Loss are mutually exclusive — Indian P&L pair convention.
            new("Purchase Amount", r => r.PurchaseAmount, AccountsXlsxWriter.ColumnFormat.Currency),
            new("Profit",          r => r.Profit,         AccountsXlsxWriter.ColumnFormat.Currency),
            new("Loss",            r => r.Loss,           AccountsXlsxWriter.ColumnFormat.Currency),
        };
        return XlsxResult("by-category", filters, rows, cols);
    }

    [HttpGet("export/top-products")]
    public async Task<IActionResult> ExportTopProducts([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetTopProductsAsync(filters, ct);
        var cols = new List<AccountsXlsxWriter.Column<AccountsProductRowDto>>
        {
            new("Product Code",   r => r.ProductCode),
            new("Product Name",   r => r.ProductName),
            // Weight is a composite "value + unit" string — kept as text.
            new("Weight",         r => r.WeightValue.HasValue
                                       ? $"{r.WeightValue.Value.ToString("0.###", CultureInfo.InvariantCulture)} {r.WeightUnit}"
                                       : null),
            new("Quantity",       r => r.Quantity, AccountsXlsxWriter.ColumnFormat.Integer),
            new("Amount (MRP)",   r => r.Amount,   AccountsXlsxWriter.ColumnFormat.Currency),
        };
        return XlsxResult("top-products", filters, rows, cols);
    }

    [HttpGet("export/adjustments")]
    public async Task<IActionResult> ExportAdjustments([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetAdjustmentsAsync(filters, ct);
        var cols = new List<AccountsXlsxWriter.Column<AccountsAdjustmentRowDto>>
        {
            // Edited-at goes in as a DateTimeOffset; the writer converts to
            // IST and applies the dd-mmm-yyyy hh:mm format. Single column,
            // both human and machine readable — no need for a parallel UTC
            // column the way the CSV had.
            new("Edited At (IST)",      r => r.EditedAt, AccountsXlsxWriter.ColumnFormat.DateTimeIst),
            new("Request Code",         r => r.RequestCode),
            new("Shop Name",            r => r.ShopName),
            new("Product Name",         r => r.ProductName),
            new("Weight",               r => r.WeightValue.HasValue
                                            ? $"{r.WeightValue.Value.ToString("0.###", CultureInfo.InvariantCulture)} {r.WeightUnit}"
                                            : null),
            new("Old Qty",              r => r.OldQty.HasValue ? (object)r.OldQty.Value : null, AccountsXlsxWriter.ColumnFormat.Integer),
            new("New Qty",              r => r.NewQty.HasValue ? (object)r.NewQty.Value : null, AccountsXlsxWriter.ColumnFormat.Integer),
            new("Qty",                  r => r.DeltaQty,      AccountsXlsxWriter.ColumnFormat.Integer),
            new("Unit Price (MRP)",     r => r.UnitPrice,     AccountsXlsxWriter.ColumnFormat.Currency),
            new("Amount (MRP)",         r => r.DeltaAmount,   AccountsXlsxWriter.ColumnFormat.Currency),
            new("Reason",               r => r.Reason),
            new("Edited By",            r => r.EditedByName),
        };
        return XlsxResult("adjustments", filters, rows, cols);
    }

    // ──────── helpers ────────

    private FileStreamResult XlsxResult<T>(
        string slug, AccountsFilters filters,
        IEnumerable<T> rows, IReadOnlyList<AccountsXlsxWriter.Column<T>> cols)
    {
        // Service has already validated `From` / `To` are present — defensive
        // fallback only.
        var from = filters.From?.ToString("yyyy-MM-dd") ?? "all";
        var to   = filters.To?.ToString("yyyy-MM-dd")   ?? "all";

        var ms = new MemoryStream();
        AccountsXlsxWriter.WriteToStream(ms, slug, rows, cols);
        ms.Position = 0;

        // Excel's official MIME type for .xlsx (Open XML).
        return new FileStreamResult(ms, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        {
            FileDownloadName = $"accounts-{slug}_{from}_to_{to}.xlsx",
        };
    }
}
