namespace KovilpattiSnacks.Business.DTOs.StockRequests;

public record CumulativePendingLineDto(
    Guid    ProductId,
    string  ProductCode,
    string  ProductName,
    string  CategoryName,
    string  Type,
    decimal? WeightValue,
    string?  WeightUnit,
    long    TotalQty,
    long    RequestCount
);
