namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// One row of the per-shop request-count summary. Shops with zero matching
/// requests are not present — the SP's INNER JOIN prunes them.
public record ShopRequestCountDto(
    Guid   ShopId,
    string ShopCode,
    string ShopName,
    long   RequestCount
);
