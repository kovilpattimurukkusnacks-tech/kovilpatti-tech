using ClosedXML.Excel;

namespace KovilpattiSnacks.Business.Implementation;

/// Phase 4d — parses an opening-stock sheet (.xlsx / .csv). Same header-map
/// approach as ProductImportParser: header names are case-insensitive,
/// spaces → underscores, column order doesn't matter.
///   code       required — product code (P001) or barcode
///   qty        required — counted on-hand (packets; decimals allowed)
///   unit_cost  optional — cost per unit for stock coming in
/// Values come back raw (strings); the service validates them.
internal static class OpeningStockImportParser
{
    public sealed record RawRow(int RowNumber, string? Code, string? Qty, string? UnitCost);

    private static readonly string[] KnownHeaders    = ["code", "qty", "unit_cost"];
    private static readonly string[] RequiredHeaders = ["code", "qty"];

    public static List<RawRow> Parse(Stream fileStream, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".xlsx" => ParseXlsx(fileStream),
            ".csv"  => ParseCsv(fileStream),
            _       => throw new InvalidOperationException($"Unsupported file type '{ext}'. Use .xlsx or .csv."),
        };
    }

    private static List<RawRow> ParseXlsx(Stream stream)
    {
        using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheets.FirstOrDefault()
            ?? throw new InvalidOperationException("Workbook has no sheets.");
        var headerRow = sheet.FirstRowUsed()
            ?? throw new InvalidOperationException("Sheet is empty.");

        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in headerRow.CellsUsed())
        {
            var key = NormalizeHeader(cell.GetString());
            if (!string.IsNullOrEmpty(key)) headerMap[key] = cell.Address.ColumnNumber;
        }
        ValidateRequiredHeaders(headerMap);

        var rows = new List<RawRow>();
        foreach (var row in sheet.RowsUsed())
        {
            if (row.RowNumber() <= headerRow.RowNumber()) continue;
            string? Get(string key) =>
                headerMap.TryGetValue(key, out var col) ? row.Cell(col).GetString()?.Trim() : null;
            if (KnownHeaders.All(h => string.IsNullOrWhiteSpace(Get(h)))) continue;
            rows.Add(new RawRow(row.RowNumber(), Get("code"), Get("qty"), Get("unit_cost")));
        }
        return rows;
    }

    private static List<RawRow> ParseCsv(Stream stream)
    {
        using var reader = new StreamReader(stream);
        var headerLine = reader.ReadLine() ?? throw new InvalidOperationException("CSV is empty.");
        var headerCells = SplitCsvLine(headerLine);
        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headerCells.Count; i++)
        {
            var key = NormalizeHeader(headerCells[i]);
            if (!string.IsNullOrEmpty(key)) headerMap[key] = i;
        }
        ValidateRequiredHeaders(headerMap);

        var rows = new List<RawRow>();
        var rowNumber = 1;
        while (reader.ReadLine() is { } line)
        {
            rowNumber++;
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cells = SplitCsvLine(line);
            string? Get(string key) =>
                headerMap.TryGetValue(key, out var col) && col < cells.Count ? cells[col]?.Trim() : null;
            if (KnownHeaders.All(h => string.IsNullOrWhiteSpace(Get(h)))) continue;
            rows.Add(new RawRow(rowNumber, Get("code"), Get("qty"), Get("unit_cost")));
        }
        return rows;
    }

    private static string NormalizeHeader(string? raw)
        => (raw ?? string.Empty).Trim().ToLowerInvariant().Replace(' ', '_');

    private static void ValidateRequiredHeaders(Dictionary<string, int> map)
    {
        var missing = RequiredHeaders.Where(h => !map.ContainsKey(h)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException(
                $"Missing required columns: {string.Join(", ", missing)}. Expected headers: code, qty, unit_cost (optional).");
    }

    // Minimal RFC-4180-ish split — quoted fields, embedded commas / quotes.
    private static List<string> SplitCsvLine(string line)
    {
        var cells = new List<string>();
        var sb = new System.Text.StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                    else inQuotes = false;
                }
                else sb.Append(ch);
            }
            else if (ch == ',') { cells.Add(sb.ToString()); sb.Clear(); }
            else if (ch == '"') inQuotes = true;
            else sb.Append(ch);
        }
        cells.Add(sb.ToString());
        return cells;
    }
}
