using System.ComponentModel.DataAnnotations;

namespace KovilpattiSnacks.Business.DTOs.ShopInventory;

/// Admin manual adjustment (damaged goods, expiry write-off, one-off
/// correction). `QtyDelta` is signed — negative writes stock off, positive
/// adds it. Shop users don't use this endpoint — they go through the
/// stock-take flow which produces the same Adjustment movement type but
/// with a session audit trail.
public record AdjustInventoryRequest(
    [Required] Guid   ProductId,
    /// Signed delta. Non-zero.
    decimal QtyDelta,
    /// Free-text reason — stored as the movement note. Required so admin
    /// can't quietly write off stock without justification.
    [Required, MinLength(3), MaxLength(500)] string Reason);
