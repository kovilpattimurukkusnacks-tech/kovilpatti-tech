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

    /// <summary>
    /// Per-shop-per-category operating expenses in the date range. Powers
    /// the Net Profit KPI + Utilities columns on the admin Dashboard /
    /// Accounts screens (15-Jul-2026). Only From/To/ShopIds are honoured;
    /// InventoryIds and CategoryIds are ignored by design.
    /// </summary>
    [HttpGet("utilities")]
    public async Task<ActionResult<IReadOnlyList<AccountsUtilityRowDto>>> Utilities([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetUtilitiesAsync(filters, ct));

    /// <summary>
    /// Company-wide Inventory-role staff salary total in the date range
    /// (18-Jul-2026). Only From/To are honoured — godowns aren't shop-scoped
    /// like the rest of Accounts. Feeds Net Profit as its own line item.
    /// </summary>
    [HttpGet("godown-expenses")]
    public async Task<ActionResult<AccountsGodownExpensesDto>> GodownExpenses([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetGodownExpensesAsync(filters, ct));

    /// <summary>
    /// Per-inventory-per-category operational expenses in the date range
    /// (rent / electricity / salary / … logged via the Inventory Expenses
    /// screen). Powers the "Inventory Expenses" KPI + Net Profit
    /// derivation on the admin Accounts screen (21-Jul-2026).
    /// Distinct from /godown-expenses above — that one is staff-salary
    /// tracking, a different feature.
    /// </summary>
    [HttpGet("inventory-expenses")]
    public async Task<ActionResult<IReadOnlyList<AccountsInventoryExpenseRowDto>>> InventoryExpenses([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetInventoryExpensesAsync(filters, ct));

    /// <summary>
    /// Per-inventory staff-salary rollup for the "By Godown" panel
    /// (21-Jul-2026). Same source data as /godown-expenses (a scalar),
    /// just grouped by godown.
    /// </summary>
    [HttpGet("godown-expenses-by-inventory")]
    public async Task<ActionResult<IReadOnlyList<AccountsGodownExpenseByInventoryRowDto>>> GodownExpensesByInventory([FromQuery] AccountsFilters filters, CancellationToken ct)
        => Ok(await accounts.GetGodownExpensesByInventoryAsync(filters, ct));

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
        var view = NormalizeView(filters.View);
        // 19-Jun-2026 (client #13): drop columns server-side so the exported
        // file matches the FE's active view-mode (Requested / Dispatched /
        // Returns / All). Always keep identity columns (Shop Code / Name).
        var cols = new List<AccountsXlsxWriter.Column<AccountsShopRowDto>>
        {
            new("Shop Code",            r => r.ShopCode),
            new("Shop Name",            r => r.ShopName),
        };
        if (view is "all" or "requested" or "dispatched")
            cols.Add(new("Order Requests",   r => r.OrderRequestCount,  AccountsXlsxWriter.ColumnFormat.Integer));
        if (view is "all" or "returns")
            cols.Add(new("Return Requests",  r => r.ReturnRequestCount, AccountsXlsxWriter.ColumnFormat.Integer));
        if (view is "all" or "requested")
            cols.Add(new("Requested Qty",    r => r.RequestedQty,       AccountsXlsxWriter.ColumnFormat.Integer));
        if (view is "all" or "dispatched")
            cols.Add(new("Dispatched Qty",   r => r.DispatchedQty,      AccountsXlsxWriter.ColumnFormat.Integer));
        if (view is "all" or "returns")
            cols.Add(new("Returned Qty",     r => r.ReturnedQty,        AccountsXlsxWriter.ColumnFormat.Integer));
        if (view is "all" or "requested")
            cols.Add(new("Requested (MRP)",  r => r.RequestedAmount,    AccountsXlsxWriter.ColumnFormat.Currency));
        if (view is "all" or "dispatched")
            cols.Add(new("Dispatched (MRP)", r => r.DispatchedAmount,   AccountsXlsxWriter.ColumnFormat.Currency));
        if (view is "all" or "returns")
            cols.Add(new("Returns (MRP)",    r => r.ReturnsAmount,      AccountsXlsxWriter.ColumnFormat.Currency));
        if (view is "all" or "dispatched")
            cols.Add(new("Adjustments (MRP)",r => r.AdjustmentsAmount,  AccountsXlsxWriter.ColumnFormat.Currency));
        if (view == "all")
            cols.Add(new("Net (MRP)",        r => r.NetAmount,          AccountsXlsxWriter.ColumnFormat.Currency));
        // Cost-side metrics — only meaningful when dispatched goods are in scope.
        if (view is "all" or "dispatched")
        {
            cols.Add(new("Purchase Amount", r => r.PurchaseAmount,      AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Profit",          r => r.Profit,              AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Loss",            r => r.Loss,                AccountsXlsxWriter.ColumnFormat.Currency));
        }
        return XlsxResult("by-shop", filters, rows, cols);
    }

    [HttpGet("export/by-category")]
    public async Task<IActionResult> ExportByCategory([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetByCategoryAsync(filters, ct);
        var view = NormalizeView(filters.View);
        var cols = new List<AccountsXlsxWriter.Column<AccountsCategoryRowDto>>
        {
            new("Category Path", r => r.CategoryPath),
        };
        // Per-view column set — match what the FE table shows on screen so
        // the exported file looks like the active lens.
        if (view == "all")
        {
            cols.Add(new("Quantity (Net)",    r => r.Quantity,        AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Amount (MRP Net)",  r => r.Amount,          AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Purchase Amount",   r => r.PurchaseAmount,  AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Profit",            r => r.Profit,          AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Loss",              r => r.Loss,            AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else if (view == "requested")
        {
            cols.Add(new("Requested Qty",     r => r.RequestedQty,    AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Requested (MRP)",   r => r.RequestedAmount, AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else if (view == "dispatched")
        {
            cols.Add(new("Dispatched Qty",    r => r.DispatchedQty,   AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Dispatched (MRP)",  r => r.DispatchedAmount,AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Purchase Amount",   r => r.PurchaseAmount,  AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Profit",            r => r.Profit,          AccountsXlsxWriter.ColumnFormat.Currency));
            cols.Add(new("Loss",              r => r.Loss,            AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else // returns
        {
            cols.Add(new("Returns Qty",       r => r.ReturnsQty,      AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Returns (MRP)",     r => r.ReturnsAmount,   AccountsXlsxWriter.ColumnFormat.Currency));
        }
        return XlsxResult("by-category", filters, rows, cols);
    }

    [HttpGet("export/top-products")]
    public async Task<IActionResult> ExportTopProducts([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var rows = await accounts.GetTopProductsAsync(filters, ct);
        var view = NormalizeView(filters.View);
        var cols = new List<AccountsXlsxWriter.Column<AccountsProductRowDto>>
        {
            new("Product Code",   r => r.ProductCode),
            new("Product Name",   r => r.ProductName),
            // Weight is a composite "value + unit" string — kept as text.
            new("Weight",         r => r.WeightValue.HasValue
                                       ? $"{r.WeightValue.Value.ToString("0.###", CultureInfo.InvariantCulture)} {r.WeightUnit}"
                                       : null),
        };
        if (view == "all")
        {
            cols.Add(new("Quantity (Net)",   r => r.Quantity,         AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Amount (MRP Net)", r => r.Amount,           AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else if (view == "requested")
        {
            cols.Add(new("Requested Qty",    r => r.RequestedQty,     AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Requested (MRP)",  r => r.RequestedAmount,  AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else if (view == "dispatched")
        {
            cols.Add(new("Dispatched Qty",   r => r.DispatchedQty,    AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Dispatched (MRP)", r => r.DispatchedAmount, AccountsXlsxWriter.ColumnFormat.Currency));
        }
        else // returns
        {
            cols.Add(new("Returns Qty",      r => r.ReturnsQty,       AccountsXlsxWriter.ColumnFormat.Integer));
            cols.Add(new("Returns (MRP)",    r => r.ReturnsAmount,    AccountsXlsxWriter.ColumnFormat.Currency));
        }
        return XlsxResult("top-products", filters, rows, cols);
    }

    [HttpGet("export/adjustments")]
    public async Task<IActionResult> ExportAdjustments([FromQuery] AccountsFilters filters, CancellationToken ct)
    {
        var allRows = await accounts.GetAdjustmentsAsync(filters, ct);
        // 19-Jun-2026 (client #13): filter to the active view's request-type
        // slice so the downloaded Excel matches the on-screen audit log.
        // 'requested' is never reached here — the FE hides the export
        // button in that view — but guarded defensively anyway.
        var view = NormalizeView(filters.View);
        IEnumerable<AccountsAdjustmentRowDto> rows = view switch
        {
            "returns"    => allRows.Where(r => r.RequestType == "Return"),
            "dispatched" => allRows.Where(r => r.RequestType == "Order"),
            "requested"  => Enumerable.Empty<AccountsAdjustmentRowDto>(),
            _            => allRows,
        };
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

    /// <summary>
    /// Normalizes the view query param to a known token. Any unrecognized
    /// value falls back to 'all' — defensive against typos or stale links.
    /// Only the Excel export endpoints honour this; JSON endpoints always
    /// return all dimensions (FE switches views without a refetch).
    /// </summary>
    private static string NormalizeView(string? raw) => raw?.ToLowerInvariant() switch
    {
        "requested"  => "requested",
        "dispatched" => "dispatched",
        "returns"    => "returns",
        _            => "all",
    };

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
