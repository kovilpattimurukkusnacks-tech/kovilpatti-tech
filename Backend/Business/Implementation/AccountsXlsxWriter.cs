using ClosedXML.Excel;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// XLSX writer for the Accounts export endpoints. Replaces the prior
/// CSV-with-BOM approach (client #11, 13-Jun-2026): writes a native Excel
/// workbook so amounts behave as numbers (sortable, summable, formula-able)
/// and timestamps as dates — no more "number stored as text" green triangles.
///
/// Each export defines a column list of (label, value-selector, format).
/// The selector returns an <see cref="object"/> so callers can hand back
/// the right primitive type for the cell — decimal for currency, int / long
/// for counts, DateTimeOffset for timestamps, string for composite fields
/// (e.g. "100 g"). Null values render as empty cells.
///
/// Sheet styling: bold header row with a cream fill, frozen first row,
/// columns auto-fitted to content. One worksheet per export — admin
/// receives a single-tab .xlsx, simplest mental model.
/// </summary>
public static class AccountsXlsxWriter
{
    /// <summary>One report column. <paramref name="Format"/> tells the writer
    /// which Excel number/date format string to apply.</summary>
    public record Column<T>(string Label, Func<T, object?> ValueSelector, ColumnFormat Format = ColumnFormat.Text);

    public enum ColumnFormat
    {
        /// <summary>Default — no number/date format applied. Used for plain
        /// text columns (codes, names, free-text reason fields).</summary>
        Text,
        /// <summary>Integer with thousands separator (e.g. 1,234).</summary>
        Integer,
        /// <summary>Indian rupee, two-decimal places, thousands separator
        /// (e.g. ₹1,23,456.78). Excel honours the locale-specific "₹" symbol.</summary>
        Currency,
        /// <summary>IST-displayed timestamp ("dd-mmm-yyyy hh:mm"). The
        /// selector should return a DateTimeOffset; the writer converts it
        /// to IST (+05:30) so admins see local time.</summary>
        DateTimeIst,
    }

    public static void WriteToStream<T>(Stream output, string sheetName, IEnumerable<T> rows, IReadOnlyList<Column<T>> columns)
    {
        using var workbook = new XLWorkbook();
        // Sheet names: max 31 chars, no [ ] : * ? / \. Slug we get from the
        // controller is already safe (e.g. "by-shop"); cap defensively.
        var safeSheet = sheetName.Length > 31 ? sheetName[..31] : sheetName;
        var ws = workbook.Worksheets.Add(safeSheet);

        // Header row — bold, cream fill matching the app's table headers.
        for (int i = 0; i < columns.Count; i++)
        {
            var cell = ws.Cell(1, i + 1);
            cell.Value = columns[i].Label;
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFFBE6");
            cell.Style.Border.BottomBorder = XLBorderStyleValues.Medium;
        }

        // Data rows — start at Excel row 2 (1-indexed).
        int rowIdx = 2;
        foreach (var row in rows)
        {
            for (int i = 0; i < columns.Count; i++)
            {
                var col   = columns[i];
                var cell  = ws.Cell(rowIdx, i + 1);
                var value = col.ValueSelector(row);

                AssignValue(cell, value);
                ApplyFormat(cell, col.Format);
            }
            rowIdx++;
        }

        // Freeze header + auto-fit. AdjustToContents reads the just-written
        // values so it must come AFTER the data loop.
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents();

        workbook.SaveAs(output);
    }

    /// <summary>Hand a primitive to the cell. ClosedXML's XLCellValue struct
    /// has implicit conversions for the common types; we go through a
    /// switch so unknown types fall back to ToString instead of throwing.</summary>
    private static void AssignValue(IXLCell cell, object? value)
    {
        switch (value)
        {
            case null:                cell.Value = string.Empty; break;
            case string s:            cell.Value = s; break;
            case decimal d:           cell.Value = d; break;
            case double dbl:          cell.Value = dbl; break;
            case int n:               cell.Value = n; break;
            case long l:              cell.Value = l; break;
            case bool b:              cell.Value = b; break;
            case DateTimeOffset dto:  cell.Value = dto.ToOffset(TimeSpan.FromMinutes(330)).DateTime; break;
            case DateTime dt:         cell.Value = dt; break;
            case DateOnly d2:         cell.Value = d2.ToDateTime(TimeOnly.MinValue); break;
            default:                  cell.Value = value.ToString() ?? string.Empty; break;
        }
    }

    private static void ApplyFormat(IXLCell cell, ColumnFormat format)
    {
        switch (format)
        {
            case ColumnFormat.Integer:
                // Indian grouping — three digits then groups of two
                // (1,00,000 not 100,000). Matches the FE's formatINR utility.
                cell.Style.NumberFormat.Format = "#,##,##0";
                break;
            case ColumnFormat.Currency:
                // Indian rupee with lakh/crore grouping. Literal-quoted "₹"
                // (not the [$₹-en-IN] LCID tag) so the explicit `#,##,##0`
                // grouping isn't overridden by Excel's locale-defaulting
                // behavior — without this, US-locale Excel renders the
                // amounts with 3-digit commas (932,319.00) instead of
                // Indian lakh grouping (9,32,319.00). Two-section format
                // shows negatives with a leading minus.
                cell.Style.NumberFormat.Format = "\"₹\"#,##,##0.00;-\"₹\"#,##,##0.00";
                break;
            case ColumnFormat.DateTimeIst:
                cell.Style.NumberFormat.Format = "dd-mmm-yyyy hh:mm";
                break;
            case ColumnFormat.Text:
            default:
                // Leave Excel's default General format.
                break;
        }
    }
}
