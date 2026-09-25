using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.AdminPos;

namespace KovilpattiSnacks.Business.Interface;

/// Phase 4d — admin-side, read-only POS views across all shops (bills,
/// returns, day-end closes, credit customers, sales reports). shopId null =
/// all shops. Admin only.
public interface IAdminPosService
{
    Task<PagedResult<AdminBillListItemDto>> ListBillsAsync(
        Guid? shopId, string? search, string? status, string? paymentMode,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default);

    Task<AdminBillDetailDto> GetBillAsync(Guid billId, CancellationToken ct = default);

    Task<PagedResult<AdminBillReturnListItemDto>> ListReturnsAsync(
        Guid? shopId, string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<AdminBillReturnDetailDto> GetReturnAsync(Guid returnId, CancellationToken ct = default);

    Task<PagedResult<AdminEodSessionDto>> ListEodAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, bool varianceOnly,
        int page, int pageSize, CancellationToken ct = default);

    Task<IReadOnlyList<AdminEodDenominationDto>> EodDenominationsAsync(Guid sessionId, CancellationToken ct = default);

    Task<AdminCustomerPageDto> ListCustomersAsync(
        Guid? shopId, string? search, bool outstandingOnly,
        int page, int pageSize, CancellationToken ct = default);

    Task<PagedResult<DTOs.Customers.CustomerLedgerEntryDto>> CustomerLedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default);

    Task<AdminSalesSummaryDto> SalesSummaryAsync(Guid? shopId, DateOnly? from, DateOnly? to, CancellationToken ct = default);

    Task<IReadOnlyList<AdminSalesShopRowDto>> SalesByShopAsync(DateOnly? from, DateOnly? to, CancellationToken ct = default);

    Task<IReadOnlyList<AdminSalesDayRowDto>> SalesDailyAsync(Guid? shopId, DateOnly? from, DateOnly? to, CancellationToken ct = default);

    Task<IReadOnlyList<AdminSalesProductRowDto>> SalesTopProductsAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, int limit, CancellationToken ct = default);
}
