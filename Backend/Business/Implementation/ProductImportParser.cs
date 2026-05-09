using ClosedXML.Excel;

namespace KovilpattiSnacks.Business.Implementation;

internal static class ProductImportParser
{
    public sealed record RawRow(
        int RowNumber,
        string? Name,
        string? Category,
        string? Type,
        string? WeightValue,
        string? WeightUnit,
        string? Mrp,
        string? PurchasePrice,
        string? Active);

    private static readonly string[] ExpectedHeaders =
        ["name", "category", "type", "weight_value", "weight_unit", "mrp", "purchase_price", "active"];

    private static readonly string[] RequiredHeaders =
        ["name", "category", "type", "mrp", "purchase_price"];

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

        // Map header name -> actual Excel column number. Using the cell's real
        // column index (not a sequential counter) so files with empty leading
        // columns (e.g. data starting at column B) parse correctly.
        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var cell in headerRow.CellsUsed())
        {
            var key = NormalizeHeader(cell.GetString());
            if (!string.IsNullOrEmpty(key))
                headerMap[key] = cell.Address.ColumnNumber;
        }
        ValidateRequiredHeaders(headerMap);

        var headerRowNumber = headerRow.RowNumber();
        var rows = new List<RawRow>();
        foreach (var row in sheet.RowsUsed())
        {
            if (row.RowNumber() <= headerRowNumber) continue;

            string? Get(string key) =>
                headerMap.TryGetValue(key, out var col)
                    ? row.Cell(col).GetString()?.Trim() : null;

            if (ExpectedHeaders.All(h => string.IsNullOrWhiteSpace(Get(h)))) continue;

            rows.Add(new RawRow(
                row.RowNumber(),
                Get("name"),
                Get("category"),
                Get("type"),
                Get("weight_value"),
                Get("weight_unit"),
                Get("mrp"),
                Get("purchase_price"),
                Get("active")));
        }
        return rows;
    }

    private static List<RawRow> ParseCsv(Stream stream)
    {
        using var reader = new StreamReader(stream);
        var headerLine = reader.ReadLine()
            ?? throw new InvalidOperationException("CSV is empty.");
        var headerCells = SplitCsvLine(headerLine);

        var headerMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < headerCells.Count; i++)
        {
            var key = NormalizeHeader(headerCells[i]);
            if (!string.IsNullOrEmpty(key))
                headerMap[key] = i + 1; // 1-indexed for parity with xlsx
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
                headerMap.TryGetValue(key, out var col) && col - 1 < cells.Count
                    ? cells[col - 1]?.Trim() : null;

            if (ExpectedHeaders.All(h => string.IsNullOrWhiteSpace(Get(h)))) continue;

            rows.Add(new RawRow(
                rowNumber,
                Get("name"),
                Get("category"),
                Get("type"),
                Get("weight_value"),
                Get("weight_unit"),
                Get("mrp"),
                Get("purchase_price"),
                Get("active")));
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
                $"Missing required columns: {string.Join(", ", missing)}. Expected headers: {string.Join(", ", ExpectedHeaders)}.");
    }

    // Minimal RFC-4180-ish CSV split — handles quoted fields and embedded commas/quotes.
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
            else
            {
                if (ch == ',') { cells.Add(sb.ToString()); sb.Clear(); }
                else if (ch == '"') inQuotes = true;
                else sb.Append(ch);
            }
        }
        cells.Add(sb.ToString());
        return cells;
    }
}
