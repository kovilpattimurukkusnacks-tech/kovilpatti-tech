using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class AdminPosRepository(IDbConnectionFactory factory) : IAdminPosRepository
{
    public async Task<List<AdminBillListRow>> ListBillsAsync(
        Guid? shopId, string? search, string? status, string? paymentMode,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_admin_bill_list(@p_shop_id, @p_search, @p_status, @p_payment_mode, " +
            "@p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<AdminBillListRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_status = status, p_payment_mode = paymentMode,
            p_from = from, p_to = to, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<AdminBillHeader?> GetBillAsync(Guid billId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_bill_get(@p_bill_id)";
        return await conn.QuerySingleOrDefaultAsync<AdminBillHeader>(new CommandDefinition(
            sql, new { p_bill_id = billId }, cancellationToken: ct));
    }

    public async Task<List<AdminBillReturnListRow>> ListReturnsAsync(
        Guid? shopId, string? search, Guid? sourceBillId,
        DateOnly? from, DateOnly? to, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_admin_bill_return_list(@p_shop_id, @p_search, @p_source_bill_id, " +
            "@p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<AdminBillReturnListRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_source_bill_id = sourceBillId,
            p_from = from, p_to = to, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<AdminBillReturnHeader?> GetReturnAsync(Guid returnId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_bill_return_get(@p_return_id)";
        return await conn.QuerySingleOrDefaultAsync<AdminBillReturnHeader>(new CommandDefinition(
            sql, new { p_return_id = returnId }, cancellationToken: ct));
    }

    public async Task<List<AdminEodRow>> ListEodAsync(
        Guid? shopId, DateOnly? from, DateOnly? to, bool varianceOnly,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_admin_eod_list(@p_shop_id, @p_from, @p_to, @p_variance_only, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<AdminEodRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_from = from, p_to = to, p_variance_only = varianceOnly,
            p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<List<AdminEodDenominationRow>> EodDenominationsAsync(Guid sessionId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_eod_denominations(@p_session_id)";
        var rows = await conn.QueryAsync<AdminEodDenominationRow>(new CommandDefinition(
            sql, new { p_session_id = sessionId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<List<AdminCustomerRow>> ListCustomersAsync(
        Guid? shopId, string? search, bool outstandingOnly,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_admin_customer_list(@p_shop_id, @p_search, @p_outstanding_only, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<AdminCustomerRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_outstanding_only = outstandingOnly,
            p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<List<CustomerCreditLedgerRow>> CustomerLedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_customer_ledger(@p_customer_id, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<CustomerCreditLedgerRow>(new CommandDefinition(sql, new
        {
            p_customer_id = customerId, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<AdminSalesSummary> SalesSummaryAsync(
        Guid? shopId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_sales_summary(@p_shop_id, @p_from, @p_to)";
        return await conn.QuerySingleAsync<AdminSalesSummary>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_from = from, p_to = to }, cancellationToken: ct));
    }

    public async Task<List<AdminSalesShopRow>> SalesByShopAsync(DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_sales_by_shop(@p_from, @p_to)";
        var rows = await conn.QueryAsync<AdminSalesShopRow>(new CommandDefinition(
            sql, new { p_from = from, p_to = to }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<List<AdminSalesDayRow>> SalesDailyAsync(
        Guid? shopId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_sales_daily(@p_shop_id, @p_from, @p_to)";
        var rows = await conn.QueryAsync<AdminSalesDayRow>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_from = from, p_to = to }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<List<AdminSalesProductRow>> SalesTopProductsAsync(
        Guid? shopId, DateOnly from, DateOnly to, int limit, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_admin_sales_top_products(@p_shop_id, @p_from, @p_to, @p_limit)";
        var rows = await conn.QueryAsync<AdminSalesProductRow>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_from = from, p_to = to, p_limit = limit }, cancellationToken: ct));
        return rows.ToList();
    }
}
