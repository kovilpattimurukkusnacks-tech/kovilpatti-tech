using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Vendors;

namespace KovilpattiSnacks.Business.Interface;

public interface IVendorService
{
    Task<IReadOnlyList<VendorDto>> ListAsync(CancellationToken ct = default);
    Task<PagedResult<VendorDto>> ListPagedAsync(
        int page, int pageSize, string? search = null, bool? active = null, CancellationToken ct = default);
    Task<VendorDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<VendorDto> CreateAsync(CreateVendorRequest request, CancellationToken ct = default);
    Task<VendorDto> UpdateAsync(Guid id, UpdateVendorRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
