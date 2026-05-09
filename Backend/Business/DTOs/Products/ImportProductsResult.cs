namespace KovilpattiSnacks.Business.DTOs.Products;

public record ImportProductsResult(
    int TotalRows,
    int Imported,
    IReadOnlyList<ImportProductSkipped> Skipped,
    IReadOnlyList<ImportProductError> Errors
);

public record ImportProductSkipped(int RowNumber, string Name, string Reason);

public record ImportProductError(int RowNumber, string Message);
