using System.ComponentModel.DataAnnotations;

namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Admin manual adjustment (damaged goods, expiry write-off, one-off
/// correction). `QtyDelta` is signed — negative writes stock off, positive
/// adds it. Admin-only endpoint; no shop-user path today.
public record AdjustInventoryRequest(
    [Required] Guid   ProductId,
    /// Signed delta. Non-zero.
    decimal QtyDelta,
    /// Free-text reason — stored as the movement note. Required so admin
    /// can't quietly write off stock without justification.
    [Required, MinLength(3), MaxLength(500)] string Reason);
