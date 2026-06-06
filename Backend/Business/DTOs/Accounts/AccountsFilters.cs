namespace KovilpattiSnacks.Business.DTOs.Accounts;

/// <summary>
/// Query-string filters for every Accounts endpoint. Bound from the URL by
/// the controller. <c>From</c> and <c>To</c> are required (validator
/// enforces); the rest are optional.
/// </summary>
public class AccountsFilters
{
    /// IST calendar date (inclusive). Yyyy-MM-dd from the URL.
    public DateOnly? From { get; set; }
    /// IST calendar date (inclusive).
    public DateOnly? To { get; set; }
    /// 'day' | 'week' | 'month'. Defaults to 'day' downstream when null/empty.
    public string? Grouping { get; set; }
    /// Comma-separated shop UUIDs in the URL; binder splits to an array.
    public Guid[]? ShopIds { get; set; }
    /// Comma-separated inventory UUIDs.
    public Guid[]? InventoryIds { get; set; }
    /// Comma-separated category int ids.
    public int[]? CategoryIds { get; set; }
    /// Top-N selector for the top-products endpoint. Validator restricts to {10,25,50}.
    public int? Limit { get; set; }
}
