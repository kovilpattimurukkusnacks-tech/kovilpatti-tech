using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class ShopInventoryRepository(IDbConnectionFactory factory) : IShopInventoryRepository
{
    // ─── On-hand reads ──────────────────────────────────

    public async Task<(List<ShopInventoryOnHand> Rows, long Total)> ListOnHandAsync(
        Guid shopId, string? search, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList  = "SELECT * FROM fn_shop_inventory_on_hand(@p_shop_id, @p_search, @p_page, @p_page_size)";
        const string sqlCount = "SELECT fn_shop_inventory_on_hand_count(@p_shop_id, @p_search)";

        var args = new
        {
            p_shop_id   = shopId,
            p_search    = search,
            p_page      = page,
            p_page_size = pageSize,
        };

        var rows  = (await conn.QueryAsync<ShopInventoryOnHand>(
            new CommandDefinition(sqlList, args, cancellationToken: ct))).ToList();
        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            sqlCount, new { p_shop_id = shopId, p_search = search }, cancellationToken: ct));

        return (rows, total);
    }

    public async Task<ShopInventoryDetail?> GetOnHandAsync(
        Guid shopId, Guid productId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_inventory_get(@p_shop_id, @p_product_id)";
        return await conn.QuerySingleOrDefaultAsync<ShopInventoryDetail>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_product_id = productId }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<ShopInventoryLowStock>> LowStockAsync(
        Guid shopId, decimal threshold, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_inventory_low_stock(@p_shop_id, @p_threshold)";
        var rows = await conn.QueryAsync<ShopInventoryLowStock>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_threshold = threshold }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<decimal> ValuationAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_inventory_valuation(@p_shop_id)";
        return await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(
            sql, new { p_shop_id = shopId }, cancellationToken: ct));
    }

    // ─── Movement reads ─────────────────────────────────

    public async Task<IReadOnlyList<ShopInventoryMovement>> ListMovementsAsync(
        Guid shopId, Guid? productId, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT * FROM fn_shop_inventory_movements(
                @p_shop_id, @p_product_id, @p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<ShopInventoryMovement>(new CommandDefinition(
            sql,
            new
            {
                p_shop_id    = shopId,
                p_product_id = productId,
                p_from       = fromDate,
                p_to         = toDate,
                p_page       = page,
                p_page_size  = pageSize,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<ShopInventoryMovementBucket>> MovementSummaryAsync(
        Guid shopId, DateOnly fromDate, DateOnly toDate, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_inventory_movement_summary(@p_shop_id, @p_from, @p_to)";
        var rows = await conn.QueryAsync<ShopInventoryMovementBucket>(new CommandDefinition(
            sql,
            new { p_shop_id = shopId, p_from = fromDate, p_to = toDate },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<ShopInventoryTreeItem>> ListForTreeAsync(
        Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_inventory_tree(@p_shop_id)";
        var rows = await conn.QueryAsync<ShopInventoryTreeItem>(new CommandDefinition(
            sql, new { p_shop_id = shopId }, cancellationToken: ct));
        return rows.ToList();
    }

    // ─── Manual adjustment ──────────────────────────────

    public async Task<Guid> ManualAdjustmentAsync(
        Guid shopId, Guid productId, decimal qtyDelta, string reason,
        Guid createdBy, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_shop_inventory_manual_adjustment(
                @p_shop_id, @p_product_id, @p_qty_delta, @p_reason, @p_created_by)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(
            sql,
            new
            {
                p_shop_id    = shopId,
                p_product_id = productId,
                p_qty_delta  = qtyDelta,
                p_reason     = reason,
                p_created_by = createdBy,
            },
            cancellationToken: ct));
    }

    // ─── Stock-take flow ────────────────────────────────

    public async Task<Guid> StockTakeStartAsync(
        Guid shopId, Guid createdBy, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_stock_take_start(@p_shop_id, @p_created_by)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_created_by = createdBy }, cancellationToken: ct));
    }

    public async Task StockTakeUpsertLineAsync(
        Guid stockTakeId, Guid productId, decimal countedQty, string? note,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_stock_take_upsert_line(
                @p_stock_take_id, @p_product_id, @p_counted_qty, @p_note)";
        await conn.ExecuteAsync(new CommandDefinition(
            sql,
            new
            {
                p_stock_take_id = stockTakeId,
                p_product_id    = productId,
                p_counted_qty   = countedQty,
                p_note          = note,
            },
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<StockTakeJoinRow>> StockTakeGetAsync(
        Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_stock_take_get(@p_id)";
        var rows = await conn.QueryAsync<StockTakeJoinRow>(new CommandDefinition(
            sql, new { p_id = id }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<StockTakeListRow>> StockTakeListAsync(
        Guid shopId, string? status, DateOnly? fromDate, DateOnly? toDate,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT * FROM fn_stock_take_list(
                @p_shop_id, @p_status, @p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<StockTakeListRow>(new CommandDefinition(
            sql,
            new
            {
                p_shop_id   = shopId,
                p_status    = status,
                p_from      = fromDate,
                p_to        = toDate,
                p_page      = page,
                p_page_size = pageSize,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<long> StockTakeSubmitAsync(
        Guid id, Guid submittedBy, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_stock_take_submit(@p_id, @p_submitted_by)";
        return await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            sql, new { p_id = id, p_submitted_by = submittedBy }, cancellationToken: ct));
    }

    public async Task StockTakeCancelAsync(
        Guid id, string reason, Guid cancelledBy, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_stock_take_cancel(@p_id, @p_reason, @p_cancelled_by)";
        await conn.ExecuteAsync(new CommandDefinition(
            sql, new { p_id = id, p_reason = reason, p_cancelled_by = cancelledBy },
            cancellationToken: ct));
    }
}
