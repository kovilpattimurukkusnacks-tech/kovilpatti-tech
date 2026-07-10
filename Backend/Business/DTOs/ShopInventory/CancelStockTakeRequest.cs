using System.ComponentModel.DataAnnotations;

namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Cancel a Draft stock-take. Reason is required (appended to session
/// notes for audit). Cannot cancel a Submitted session — SP rejects.
public record CancelStockTakeRequest(
    [Required, MinLength(3), MaxLength(500)] string Reason);
