using System.Globalization;
using System.Text;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Minimal RFC 4180 CSV writer used by the Accounts export endpoints. Each
/// export defines its column list (label + selector) and hands a row stream
/// to <see cref="WriteToStream{T}"/>, which:
///
///   * emits a UTF-8 BOM up front (legacy Excel on Windows mis-detects
///     UTF-8 without one for non-ASCII names — Tamil shop names render as
///     mojibake otherwise);
///   * writes a header row of labels;
///   * writes one data row per item, quoting fields that contain comma,
///     quote, CR, or LF, and doubling internal quotes per the RFC.
///
/// Caller controls cell formatting via the selector — pass an ISO string
/// for timestamps you want machine-readable, etc.
/// </summary>
public static class AccountsCsvWriter
{
    public record Column<T>(string Label, Func<T, string?> Selector);

    private static readonly byte[] Bom = new byte[] { 0xEF, 0xBB, 0xBF };
    // Use Unix line endings inside CSV cells we generate — but RFC 4180
    // mandates CRLF as the line terminator between rows. Excel accepts both
    // but CRLF is the safer default.
    private const string LineTerminator = "\r\n";

    public static byte[] WriteToBytes<T>(IEnumerable<T> rows, IReadOnlyList<Column<T>> columns)
    {
        using var ms = new MemoryStream();
        WriteToStream(ms, rows, columns);
        return ms.ToArray();
    }

    public static void WriteToStream<T>(Stream output, IEnumerable<T> rows, IReadOnlyList<Column<T>> columns)
    {
        output.Write(Bom, 0, Bom.Length);

        // No BOM on the StreamWriter itself; we wrote one to the underlying stream
        // already. leaveOpen=true so the caller owns the lifetime of `output`.
        using var sw = new StreamWriter(output, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), bufferSize: 4096, leaveOpen: true);

        // Header row.
        sw.Write(string.Join(",", columns.Select(c => Escape(c.Label))));
        sw.Write(LineTerminator);

        // Data rows.
        foreach (var row in rows)
        {
            for (int i = 0; i < columns.Count; i++)
            {
                if (i > 0) sw.Write(',');
                sw.Write(Escape(columns[i].Selector(row)));
            }
            sw.Write(LineTerminator);
        }
    }

    private static string Escape(string? value)
    {
        if (value is null) return string.Empty;
        var needsQuotes = value.IndexOfAny([',', '"', '\r', '\n']) >= 0;
        if (!needsQuotes) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    // ──────── shared cell formatters ────────

    /// IST display string: "dd-MMM-yyyy HH:mm" with the timestamp converted
    /// from UTC to Asia/Kolkata. Matches the table label format on the FE.
    public static string FormatIst(DateTimeOffset dto)
    {
        var ist = dto.ToOffset(TimeSpan.FromMinutes(330));
        return ist.ToString("dd-MMM-yyyy HH:mm", CultureInfo.InvariantCulture);
    }

    /// ISO-8601 UTC ("2026-05-31T18:35:00Z") for machine-readable columns.
    public static string FormatIso(DateTimeOffset dto)
        => dto.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

    /// Fixed-precision decimal with `.` separator — no thousands grouping —
    /// so the CSV is locale-stable. Excel users can re-format on import.
    public static string FormatAmount(decimal d)
        => d.ToString("0.00", CultureInfo.InvariantCulture);

    public static string FormatInt(long n)
        => n.ToString(CultureInfo.InvariantCulture);

    public static string FormatIntOrEmpty(int? n)
        => n.HasValue ? n.Value.ToString(CultureInfo.InvariantCulture) : string.Empty;
}
