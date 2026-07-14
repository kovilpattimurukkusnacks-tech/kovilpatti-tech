using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class BillRepository(IDbConnectionFactory factory) : IBillRepository
{
    public async Task<List<BillingProduct>> BillingProductsAsync(
        Guid shopId, string? search, int limit, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_billing_products(@p_shop_id, @p_search, @p_limit)";
        var rows = await conn.QueryAsync<BillingProduct>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_search = search, p_limit = limit }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillCreated> CreateAsync(
        Guid shopId, Guid userId, string paymentMode, string itemsJson, string? notes,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_create(@p_shop_id, @p_user_id, @p_payment_mode, @p_items::jsonb, @p_notes)";
        return await conn.QuerySingleAsync<BillCreated>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId,
            p_user_id = userId,
            p_payment_mode = paymentMode,
            p_items = itemsJson,
            p_notes = notes,
        }, cancellationToken: ct));
    }

    public async Task CancelAsync(
        Guid billId, Guid shopId, Guid userId, string reason, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_bill_cancel(@p_bill_id, @p_shop_id, @p_user_id, @p_reason)";
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            p_bill_id = billId, p_shop_id = shopId, p_user_id = userId, p_reason = reason,
        }, cancellationToken: ct));
    }

    public async Task<List<BillListRow>> ListAsync(
        Guid shopId, string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_list(@p_shop_id, @p_search, @p_status, @p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<BillListRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_status = status,
            p_from = from, p_to = to, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillHeader?> GetAsync(Guid billId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_get(@p_bill_id, @p_shop_id)";
        return await conn.QuerySingleOrDefaultAsync<BillHeader>(new CommandDefinition(
            sql, new { p_bill_id = billId, p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<List<BillItemRow>> GetItemsAsync(Guid billId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_get_items(@p_bill_id)";
        var rows = await conn.QueryAsync<BillItemRow>(new CommandDefinition(
            sql, new { p_bill_id = billId }, cancellationToken: ct));
        return rows.ToList();
    }
}
