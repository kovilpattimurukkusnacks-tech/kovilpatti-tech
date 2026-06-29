namespace KovilpattiSnacks.Business.DTOs.Shops;

/// <summary>
/// Tiny body for PATCH /api/shops/{id}/gst-enabled — used by the
/// AdminSettings per-shop GST toggle (19-Jun-2026, client #15).
/// Single bool keeps the wire payload minimal.
/// </summary>
public record SetShopGstEnabledRequest(bool Enabled);
