using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class CustomerRepository(IDbConnectionFactory factory) : ICustomerRepository
{
    public async Task<Customer?> LookupAsync(Guid shopId, string phone, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_customer_lookup(@p_shop_id, @p_phone)";
        return await conn.QuerySingleOrDefaultAsync<Customer>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_phone = phone }, cancellationToken: ct));
    }

    public async Task<Customer> CreateAsync(
        Guid shopId, Guid userId, string name, string phone, decimal? creditLimit,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_customer_create(@p_shop_id, @p_user_id, @p_name, @p_phone, @p_credit_limit)";
        return await conn.QuerySingleAsync<Customer>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_user_id = userId, p_name = name, p_phone = phone,
            p_credit_limit = creditLimit,
        }, cancellationToken: ct));
    }

    public async Task<List<Customer>> ListAsync(
        Guid shopId, string? search, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_customer_list(@p_shop_id, @p_search, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<Customer>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<decimal> SettleAsync(
        Guid customerId, Guid shopId, Guid userId, decimal amount, string mode, string? note,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT fn_customer_credit_settle(@p_customer_id, @p_shop_id, @p_user_id, @p_amount, @p_mode, @p_note)";
        return await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(sql, new
        {
            p_customer_id = customerId, p_shop_id = shopId, p_user_id = userId,
            p_amount = amount, p_mode = mode, p_note = note,
        }, cancellationToken: ct));
    }

    public async Task<List<CustomerCreditLedgerRow>> LedgerAsync(
        Guid customerId, Guid shopId, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_customer_credit_ledger_list(@p_customer_id, @p_shop_id, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<CustomerCreditLedgerRow>(new CommandDefinition(sql, new
        {
            p_customer_id = customerId, p_shop_id = shopId, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }
}
