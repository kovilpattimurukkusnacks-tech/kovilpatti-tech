using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using NpgsqlTypes;

namespace KovilpattiSnacks.Repository.Implementation;

public class StockRequestRepository(IDbConnectionFactory factory) : IStockRequestRepository
{
    public async Task<(List<StockRequest> Rows, long Total)> ListPagedAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList  = "SELECT * FROM fn_request_list_paged(@p_shop_id, @p_inventory_id, @p_status::request_status, @p_search, @p_page, @p_page_size)";
        const string sqlCount = "SELECT fn_request_count(@p_shop_id, @p_inventory_id, @p_status::request_status, @p_search)";

        var args = new
        {
            p_shop_id      = shopId,
            p_inventory_id = inventoryId,
            p_status       = status,
            p_search       = search,
            p_page         = page,
            p_page_size    = pageSize,
        };

        var rows = (await conn.QueryAsync<StockRequest>(new CommandDefinition(sqlList, args, cancellationToken: ct))).ToList();

        var countArgs = new { p_shop_id = shopId, p_inventory_id = inventoryId, p_status = status, p_search = search };
        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sqlCount, countArgs, cancellationToken: ct));

        return (rows, total);
    }

    public async Task<StockRequest?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_request_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<StockRequest>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<CumulativePendingLine>> GetPendingCumulativeAsync(
        Guid? inventoryId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_request_pending_cumulative(@p_inventory_id)";
        var rows = await conn.QueryAsync<CumulativePendingLine>(new CommandDefinition(
            sql, new { p_inventory_id = inventoryId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<ShopRequestCount>> GetCountByShopAsync(
        string? status, Guid? inventoryId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // p_status is text in the SP; the SP itself casts to request_status enum
        // so callers don't have to know the custom PG type name.
        const string sql = "SELECT * FROM fn_request_count_by_shop(@p_status, @p_inventory_id)";
        var rows = await conn.QueryAsync<ShopRequestCount>(new CommandDefinition(
            sql, new { p_status = status, p_inventory_id = inventoryId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct))
            ?? "REQ0001";
    }

    public async Task<Guid> CreateAsync(
        string code, Guid shopId, Guid inventoryId,
        DateTimeOffset editableUntil, string? notes,
        string itemsJson, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_request_create(
                @p_code, @p_shop_id, @p_inventory_id,
                @p_editable_until, @p_notes,
                @p_items::jsonb, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code            = code,
            p_shop_id         = shopId,
            p_inventory_id    = inventoryId,
            p_editable_until  = editableUntil,
            p_notes           = notes,
            p_items           = itemsJson,
            p_user_id         = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(Guid id, string? notes, string itemsJson, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_update(@p_id, @p_notes, @p_items::jsonb, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id      = id,
            p_notes   = notes,
            p_items   = itemsJson,
            p_user_id = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> ApproveAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_approve(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> RejectAsync(Guid id, Guid userId, string reason, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_reject(@p_id, @p_user_id, @p_reason)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId, p_reason = reason }, cancellationToken: ct));
    }

    public async Task<bool> RevokeAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_revoke(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> DispatchAsync(Guid id, Guid userId, string dispatchedItemsJson, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_dispatch(@p_id, @p_user_id, @p_items::jsonb)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id      = id,
            p_user_id = userId,
            p_items   = dispatchedItemsJson
        }, cancellationToken: ct));
    }

    public async Task<bool> ReceiveAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_receive(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_cancel(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    // ── Shop drafts ───────────────────────────────────────────────

    public async Task<Guid> SaveShopDraftAsync(
        Guid shopId, Guid inventoryId, string? notes, string itemsJson, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_request_save_shop_draft(
                @p_shop_id, @p_inventory_id, @p_notes,
                @p_items::jsonb, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_shop_id      = shopId,
            p_inventory_id = inventoryId,
            p_notes        = notes,
            p_items        = itemsJson,
            p_user_id      = userId,
        }, cancellationToken: ct));
    }

    public async Task<StockRequest?> GetShopDraftAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_request_get_shop_draft(@p_shop_id)";
        return await conn.QuerySingleOrDefaultAsync<StockRequest>(
            new CommandDefinition(sql, new { p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<bool> DeleteShopDraftAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_delete_shop_draft(@p_shop_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_shop_id = shopId }, cancellationToken: ct));
    }

    // ── Inventory dispatch draft ──────────────────────────────────

    public async Task<bool> SaveDispatchDraftAsync(
        Guid id, Guid userId, string itemsJson, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_save_dispatch_draft(@p_id, @p_user_id, @p_items::jsonb)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id      = id,
            p_user_id = userId,
            p_items   = itemsJson,
        }, cancellationToken: ct));
    }

    public async Task<bool> ClearDispatchDraftAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_clear_dispatch_draft(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<StockRequest>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_request_list_inventory_dispatch_drafts(@p_inventory_id)";
        var rows = await conn.QueryAsync<StockRequest>(new CommandDefinition(
            sql, new { p_inventory_id = inventoryId }, cancellationToken: ct));
        return rows.ToList();
    }
}
