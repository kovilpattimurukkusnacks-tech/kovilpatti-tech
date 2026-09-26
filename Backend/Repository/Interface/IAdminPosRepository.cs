using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

/// Phase 4d — admin-side, read-only access to POS data across all shops.
/// A null shopId means "all shops". Dates are IST calendar dates, inclusive.
public interface IAdminPosRepository
{
    Task<List<AdminBillListRow>> ListBillsAsync(
        Guid? shopId, string? search, string? status, string? paymentMode,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default);

    Task<AdminBillHeader?> GetBillAsync(Guid billId, CancellationToken ct = default);

    Task<List<AdminBillReturnListRow>> ListReturnsAsync(
        Guid? shopId, string? search, Guid? sourceBillId,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default);

    Task<AdminBillReturnHeader?> GetReturnAsync(Guid returnId, CancellationToken ct = default);

    Task<List<AdminEodRow>> ListEodAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, bool varianceOnly,
        int page, int pageSize, CancellationToken ct = default);

    Task<List<AdminEodDenominationRow>> EodDenominationsAsync(Guid sessionId, CancellationToken ct = default);

    Task<List<AdminCustomerRow>> ListCustomersAsync(
        Guid? shopId, string? search, bool outstandingOnly,
        int page, int pageSize, CancellationToken ct = default);

    Task<List<CustomerCreditLedgerRow>> CustomerLedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default);

    Task<AdminSalesSummary> SalesSummaryAsync(Guid? shopId, DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<List<AdminSalesShopRow>> SalesByShopAsync(DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<List<AdminSalesDayRow>> SalesDailyAsync(Guid? shopId, DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<List<AdminSalesProductRow>> SalesTopProductsAsync(
        Guid? shopId, DateOnly from, DateOnly to, int limit, CancellationToken ct = default);
}
