using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.VendorPurchases;

namespace KovilpattiSnacks.Business.Interface;

public interface IVendorPurchaseService
{
    Task<PagedResult<VendorPurchaseDto>> ListAsync(
        Guid? vendorId, Guid? godownId, string? status, bool? isInterstate,
        DateOnly? fromDate, DateOnly? toDate, string? search,
        int page, int pageSize,
        CancellationToken ct = default);

    Task<VendorPurchaseDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<VendorPurchaseDto> CreateAsync(CreateVendorPurchaseRequest request, CancellationToken ct = default);
    Task<VendorPurchaseDto> UpdateAsync(Guid id, UpdateVendorPurchaseRequest request, CancellationToken ct = default);
    Task<VendorPurchaseDto> ReceiveAsync(Guid id, CancellationToken ct = default);
    Task CancelAsync(Guid id, CancellationToken ct = default);
}
