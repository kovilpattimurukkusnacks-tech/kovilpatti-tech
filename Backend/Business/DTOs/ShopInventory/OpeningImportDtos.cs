namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Phase 4d — one row of an opening-stock import preview / result.
/// Status: 'Changed' | 'Unchanged' | 'Error'. CurrentQty / Delta are null on
/// Error rows. RowNo is the spreadsheet row (header = row 1).
public record OpeningImportRowDto(
    int RowNo,
    string InputCode,
    Guid? ProductId,
    string? ProductCode,
    string? ProductName,
    decimal? CurrentQty,
    decimal? NewQty,
    decimal? Delta,
    string Status,
    string? Message);

/// DryRun = true → nothing was written (preview). Applied = true only when a
/// real import committed. The FE shows the table either way.
public record OpeningImportResultDto(
    bool DryRun,
    bool Applied,
    int ChangedCount,
    int UnchangedCount,
    int ErrorCount,
    IReadOnlyList<OpeningImportRowDto> Rows);
