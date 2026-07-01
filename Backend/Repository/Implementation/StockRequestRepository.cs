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
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        // p_request_type is the request_type enum — cast at call site so callers
        // pass a plain string ('Order'/'Return') without knowing the PG type name.
        const string sqlList  = "SELECT * FROM fn_request_list_paged(@p_shop_id, @p_inventory_id, @p_status::request_status, @p_search, @p_page, @p_page_size, @p_from_date, @p_to_date, @p_request_type::request_type)";
        const string sqlCount = "SELECT fn_request_count(@p_shop_id, @p_inventory_id, @p_status::request_status, @p_search, @p_from_date, @p_to_date, @p_request_type::request_type)";

        var args = new
        {
            p_shop_id      = shopId,
            p_inventory_id = inventoryId,
            p_status       = status,
            p_search       = search,
            p_page         = page,
            p_page_size    = pageSize,
            p_from_date    = fromDate,
            p_to_date      = toDate,
            p_request_type = requestType,
        };

        var rows = (await conn.QueryAsync<StockRequest>(new CommandDefinition(sqlList, args, cancellationToken: ct))).ToList();

        var countArgs = new { p_shop_id = shopId, p_inventory_id = inventoryId, p_status = status, p_search = search, p_from_date = fromDate, p_to_date = toDate, p_request_type = requestType };
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
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // p_status is text in the SP; the SP itself casts to request_status enum
        // so callers don't have to know the custom PG type name. Same for
        // p_request_type — text in C#, cast to request_type enum at call site.
        const string sql = "SELECT * FROM fn_request_count_by_shop(@p_status, @p_inventory_id, @p_from_date, @p_to_date, @p_request_type::request_type)";
        var rows = await conn.QueryAsync<ShopRequestCount>(new CommandDefinition(
            sql, new { p_status = status, p_inventory_id = inventoryId, p_from_date = fromDate, p_to_date = toDate, p_request_type = requestType }, cancellationToken: ct));
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

    // ── Return Stock ──────────────────────────────────────────────

    public async Task<Guid> CreateReturnAsync(
        string code, Guid shopId, Guid inventoryId,
        Guid? sourceRequestId, string? notes,
        string itemsJson, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_request_create_return(
                @p_code, @p_shop_id, @p_inventory_id,
                @p_source_request_id, @p_notes,
                @p_items::jsonb, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code              = code,
            p_shop_id           = shopId,
            p_inventory_id      = inventoryId,
            p_source_request_id = sourceRequestId,
            p_notes             = notes,
            p_items             = itemsJson,
            p_user_id           = userId,
        }, cancellationToken: ct));
    }

    public async Task<bool> AcceptReturnAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_accept_return(@p_id, @p_user_id, @p_items::jsonb)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id      = id,
            p_user_id = userId,
            p_items   = itemsJson,
        }, cancellationToken: ct));
    }

    public async Task<bool> EditDispatchedQtyAsync(
        Guid itemId, int? newQty, string? reason, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        // SP guards status IN ('Received','Accepted') + bounds + no-op; the
        // BE service layer enforces the Admin role check before getting here.
        const string sql = "SELECT fn_request_item_edit_dispatched_qty(@p_item_id, @p_new_qty, @p_reason, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_item_id = itemId,
            p_new_qty = newQty,
            p_reason  = reason,
            p_user_id = userId,
        }, cancellationToken: ct));
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

    public async Task<bool> RenameDispatchDraftAsync(Guid id, Guid userId, string? name, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_rename_dispatch_draft(@p_id, @p_user_id, @p_name)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId, p_name = name }, cancellationToken: ct));
    }

    public async Task<bool> PinDispatchDraftAsync(Guid id, Guid userId, bool pinned, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_pin_dispatch_draft(@p_id, @p_user_id, @p_pinned)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId, p_pinned = pinned }, cancellationToken: ct));
    }

    public async Task<bool> InventoryAddItemsAsync(Guid id, Guid userId, string itemsJson, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_inventory_add_items(@p_id, @p_user_id, @p_items::jsonb)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId, p_items = itemsJson }, cancellationToken: ct));
    }

    public async Task<bool> InventoryRemoveItemAsync(Guid id, Guid itemId, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_request_inventory_remove_item(@p_id, @p_item_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_item_id = itemId, p_user_id = userId }, cancellationToken: ct));
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
