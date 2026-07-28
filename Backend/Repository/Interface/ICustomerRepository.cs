using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface ICustomerRepository
{
    Task<Customer?> LookupAsync(Guid shopId, string phone, CancellationToken ct = default);

    Task<Customer> CreateAsync(
        Guid shopId, Guid userId, string name, string phone, decimal? creditLimit,
        CancellationToken ct = default);

    Task<List<Customer>> ListAsync(
        Guid shopId, string? search, int page, int pageSize, CancellationToken ct = default);

    Task<decimal> SettleAsync(
        Guid customerId, Guid shopId, Guid userId, decimal amount, string mode, string? note,
        CancellationToken ct = default);

    Task<List<CustomerCreditLedgerRow>> LedgerAsync(
        Guid customerId, Guid shopId, int page, int pageSize, CancellationToken ct = default);
}
