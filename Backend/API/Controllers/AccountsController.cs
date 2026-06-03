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
/// CSV export endpoints stream the same data the JSON endpoints serve, with
/// a UTF-8 BOM prefix so Excel renders Tamil shop names correctly.
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

    // ──────── CSV export endpoints ────────

    [HttpGet("export/by-shop")]
    public async Task<IActionResult> ExportByShop([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetByShopAsync(filters, ct);
        var cols = new List<AccountsCsvWriter.Column<AccountsShopRowDto>>
        {
            new("Shop Code",            r => r.ShopCode),
            new("Shop Name",            r => r.ShopName),
            new("Order Requests",       r => AccountsCsvWriter.FormatInt(r.OrderRequestCount)),
            new("Return Requests",      r => AccountsCsvWriter.FormatInt(r.ReturnRequestCount)),
            new("Dispatched Qty",       r => AccountsCsvWriter.FormatInt(r.DispatchedQty)),
            new("Dispatched (MRP ₹)",   r => AccountsCsvWriter.FormatAmount(r.DispatchedAmount)),
            new("Returns (MRP ₹)",      r => AccountsCsvWriter.FormatAmount(r.ReturnsAmount)),
            new("Net (MRP ₹)",          r => AccountsCsvWriter.FormatAmount(r.NetAmount)),
        };
        return CsvResult("by-shop", filters, rows, cols);
    }

    [HttpGet("export/by-category")]
    public async Task<IActionResult> ExportByCategory([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetByCategoryAsync(filters, ct);
        var cols = new List<AccountsCsvWriter.Column<AccountsCategoryRowDto>>
        {
            new("Category Path",   r => r.CategoryPath),
            new("Quantity",        r => AccountsCsvWriter.FormatInt(r.Quantity)),
            new("Amount (MRP ₹)",  r => AccountsCsvWriter.FormatAmount(r.Amount)),
        };
        return CsvResult("by-category", filters, rows, cols);
    }

    [HttpGet("export/top-products")]
    public async Task<IActionResult> ExportTopProducts([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetTopProductsAsync(filters, ct);
        var cols = new List<AccountsCsvWriter.Column<AccountsProductRowDto>>
        {
            new("Product Code",   r => r.ProductCode),
            new("Product Name",   r => r.ProductName),
            new("Weight",         r => r.WeightValue.HasValue
                                       ? $"{r.WeightValue.Value.ToString("0.###", CultureInfo.InvariantCulture)} {r.WeightUnit}"
                                       : string.Empty),
            new("Quantity",       r => AccountsCsvWriter.FormatInt(r.Quantity)),
            new("Amount (MRP ₹)", r => AccountsCsvWriter.FormatAmount(r.Amount)),
        };
        return CsvResult("top-products", filters, rows, cols);
    }

    [HttpGet("export/adjustments")]
    public async Task<IActionResult> ExportAdjustments([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetAdjustmentsAsync(filters, ct);
        var cols = new List<AccountsCsvWriter.Column<AccountsAdjustmentRowDto>>
        {
            new("Edited At (IST)",      r => AccountsCsvWriter.FormatIst(r.EditedAt)),
            new("Edited At (UTC)",      r => AccountsCsvWriter.FormatIso(r.EditedAt)),
            new("Request Code",         r => r.RequestCode),
            new("Shop Name",            r => r.ShopName),
            new("Product Name",         r => r.ProductName),
            new("Weight",               r => r.WeightValue.HasValue
                                            ? $"{r.WeightValue.Value.ToString("0.###", CultureInfo.InvariantCulture)} {r.WeightUnit}"
                                            : string.Empty),
            new("Old Qty",              r => AccountsCsvWriter.FormatIntOrEmpty(r.OldQty)),
            new("New Qty",              r => AccountsCsvWriter.FormatIntOrEmpty(r.NewQty)),
            new("Δ Qty",                r => r.DeltaQty.ToString(CultureInfo.InvariantCulture)),
            new("Unit Price (MRP ₹)",   r => AccountsCsvWriter.FormatAmount(r.UnitPrice)),
            new("Δ Amount (MRP ₹)",     r => AccountsCsvWriter.FormatAmount(r.DeltaAmount)),
            new("Reason",               r => r.Reason ?? string.Empty),
            new("Edited By",            r => r.EditedByName ?? string.Empty),
        };
        return CsvResult("adjustments", filters, rows, cols);
    }

    // ──────── helpers ────────

    private FileStreamResult CsvResult<T>(
        string slug, AccountsFilters filters,
        IEnumerable<T> rows, IReadOnlyList<AccountsCsvWriter.Column<T>> cols)
    {
        // Service has already validated `From` / `To` are present — but if a
        // caller somehow reaches the export endpoint with nulls, the slugs
        // below would render as "..." — guard with a fallback so the URL
        // stays sane. The service throws on missing dates anyway, so this
        // line is purely defensive.
        var from = filters.From?.ToString("yyyy-MM-dd") ?? "all";
        var to   = filters.To?.ToString("yyyy-MM-dd")   ?? "all";

        var ms = new MemoryStream();
        AccountsCsvWriter.WriteToStream(ms, rows, cols);
        ms.Position = 0;

        // text/csv with explicit utf-8 — combined with the BOM emitted by
        // the writer, this is the most-compatible recipe for legacy Excel.
        return new FileStreamResult(ms, "text/csv; charset=utf-8")
        {
            FileDownloadName = $"accounts-{slug}_{from}_to_{to}.csv",
        };
    }
}
