using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Customers;

namespace KovilpattiSnacks.Business.Interface;

public interface ICustomerService
{
    Task<CustomerDto?> LookupAsync(string phone, CancellationToken ct = default);

    Task<CustomerDto> CreateAsync(CreateCustomerRequest request, CancellationToken ct = default);

    Task<PagedResult<CustomerDto>> ListAsync(
        string? search, int page, int pageSize, CancellationToken ct = default);

    Task<decimal> SettleAsync(Guid customerId, SettleCreditRequest request, CancellationToken ct = default);

    Task<PagedResult<CustomerLedgerEntryDto>> LedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default);
}
