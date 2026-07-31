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

    // ───────── Bill returns (feature #1) ─────────

    Task<IReadOnlyList<ReturnableItemDto>> ReturnableItemsAsync(
        Guid billId, CancellationToken ct = default);

    Task<BillReturnCreatedDto> CreateReturnAsync(
        CreateBillReturnRequest request, CancellationToken ct = default);

    Task<PagedResult<BillReturnListItemDto>> ListReturnsAsync(
        string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<BillReturnDetailDto> GetReturnAsync(Guid returnId, CancellationToken ct = default);

    // ───────── Held (draft) bills (feature #3) ─────────

    Task<HeldBillCreatedDto> HoldAsync(CreateHoldRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<HeldBillListItemDto>> ListHoldsAsync(CancellationToken ct = default);

    Task<HeldBillDetailDto> GetHoldAsync(Guid heldBillId, CancellationToken ct = default);

    Task DeleteHoldAsync(Guid heldBillId, CancellationToken ct = default);
}
