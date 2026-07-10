using System.ComponentModel.DataAnnotations;

namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Save (insert or update) one counted-qty line on a Draft stock-take.
/// Callable repeatedly per product — later writes overwrite earlier ones.
/// Rejected by SP if the session is no longer Draft (Submitted/Cancelled).
public record UpsertStockTakeLineRequest(
    [Required] Guid   ProductId,
    /// Physical count. Must be ≥ 0.
    [Range(0, double.MaxValue)] decimal CountedQty,
    [MaxLength(500)] string? Note);
