using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Bills;

namespace KovilpattiSnacks.Business.Interface;

public interface IBillService
{
    Task<IReadOnlyList<BillingProductDto>> BillingProductsAsync(
        string? search, CancellationToken ct = default);

    Task<BillCreatedDto> CreateAsync(CreateBillRequest request, CancellationToken ct = default);

    Task CancelAsync(Guid billId, CancelBillRequest request, CancellationToken ct = default);

    Task<PagedResult<BillListItemDto>> ListAsync(
        string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<BillDetailDto> GetAsync(Guid billId, CancellationToken ct = default);
}
