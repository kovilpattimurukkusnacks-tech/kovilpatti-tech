using KovilpattiSnacks.Business.DTOs.ShopInventory;

namespace KovilpattiSnacks.Business.Interface;

/// Assembles the shop dashboard payload from several phase-4 + phase-2 SPs
/// so the FE only needs one round trip on page load.
public interface IShopDashboardService
{
    /// Returns the dashboard for the current shop user (own shop) OR the
    /// admin-specified shop. NotFound if the shop doesn't exist.
    Task<ShopDashboardDto> GetAsync(Guid? shopId, CancellationToken ct = default);
}
