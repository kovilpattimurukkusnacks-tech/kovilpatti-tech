using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Shops;

namespace KovilpattiSnacks.Business.Interface;

public interface IShopService
{
    Task<IReadOnlyList<ShopDto>> ListAsync(CancellationToken ct = default);
    Task<PagedResult<ShopDto>> ListPagedAsync(int page, int pageSize, CancellationToken ct = default);
    Task<ShopDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<ShopDto> CreateAsync(CreateShopRequest request, CancellationToken ct = default);
    Task<ShopDto> UpdateAsync(Guid id, UpdateShopRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
