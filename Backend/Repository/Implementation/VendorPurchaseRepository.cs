using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class VendorPurchaseRepository(IDbConnectionFactory factory) : IVendorPurchaseRepository
{
    public async Task<(List<VendorPurchase> Rows, long Total)> ListPagedAsync(
        int page, int pageSize,
        Guid? vendorId = null, Guid? godownId = null, string? status = null,
        bool? isInterstate = null, DateOnly? fromDate = null, DateOnly? toDate = null,
        string? search = null,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList = @"
            SELECT * FROM fn_vendor_purchase_list_paged(
                @p_page, @p_page_size, @p_vendor_id, @p_godown_id, @p_status,
                @p_is_interstate, @p_from_date, @p_to_date, @p_search)";
        const string sqlCount = @"
            SELECT fn_vendor_purchase_count(
                @p_vendor_id, @p_godown_id, @p_status,
                @p_is_interstate, @p_from_date, @p_to_date, @p_search)";

        var parameters = new
        {
            p_page = page,
            p_page_size = pageSize,
            p_vendor_id = vendorId,
            p_godown_id = godownId,
            p_status = status,
            p_is_interstate = isInterstate,
            p_from_date = fromDate,
            p_to_date = toDate,
            p_search = search
        };

        var rows = (await conn.QueryAsync<VendorPurchase>(new CommandDefinition(sqlList, parameters, cancellationToken: ct))).ToList();
        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sqlCount, parameters, cancellationToken: ct));

        return (rows, total);
    }

    public async Task<VendorPurchase?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_vendor_purchase_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<VendorPurchase>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_purchase_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_purchase_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct)) ?? "PUR0001";
    }

    public async Task<Guid> CreateAsync(
        string code, Guid vendorId, Guid godownId,
        string invoiceNumber, DateOnly invoiceDate, decimal invoiceAmount,
        string? notes, string itemsJson, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_vendor_purchase_create(
                @p_code, @p_vendor_id, @p_godown_id,
                @p_invoice_number, @p_invoice_date, @p_invoice_amount,
                @p_notes, @p_items::jsonb, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code = code,
            p_vendor_id = vendorId,
            p_godown_id = godownId,
            p_invoice_number = invoiceNumber,
            p_invoice_date = invoiceDate,
            p_invoice_amount = invoiceAmount,
            p_notes = notes,
            p_items = itemsJson,
            p_user_id = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(
        Guid id, string invoiceNumber, DateOnly invoiceDate, decimal invoiceAmount,
        string? notes, string itemsJson, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_vendor_purchase_update(
                @p_id, @p_invoice_number, @p_invoice_date, @p_invoice_amount,
                @p_notes, @p_items::jsonb, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id = id,
            p_invoice_number = invoiceNumber,
            p_invoice_date = invoiceDate,
            p_invoice_amount = invoiceAmount,
            p_notes = notes,
            p_items = itemsJson,
            p_user_id = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> ReceiveAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_purchase_receive(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_purchase_cancel(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
