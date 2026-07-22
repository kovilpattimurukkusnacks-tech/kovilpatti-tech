using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities.Accounts;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

/// <summary>
/// Dapper caller for fn_accounts_* stored functions. All methods are
/// SELECT-only — verified by a SQL-side grep in CI.
///
/// Array parameters: Postgres `uuid[]` / `int[]` map natively from C#
/// `Guid[]` / `int[]`. Passing `null` sends SQL NULL, which the SPs treat
/// as "no filter on this dimension".
/// </summary>
public class AccountsRepository(IDbConnectionFactory factory) : IAccountsRepository
{
    public async Task<AccountsSummary> GetSummaryAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_summary(@p_from, @p_to, @p_shop_ids, @p_inv_ids, @p_cat_ids)";
        return await conn.QuerySingleAsync<AccountsSummary>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
            },
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<AccountsTrendBucket>> GetTrendAsync(
        DateOnly from, DateOnly to, string grouping,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_trend(@p_from, @p_to, @p_grouping, @p_shop_ids, @p_inv_ids, @p_cat_ids)";
        var rows = await conn.QueryAsync<AccountsTrendBucket>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_grouping = grouping,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<AccountsShopRow>> GetByShopAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_by_shop(@p_from, @p_to, @p_shop_ids, @p_inv_ids, @p_cat_ids)";
        var rows = await conn.QueryAsync<AccountsShopRow>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<AccountsCategoryRow>> GetByCategoryAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_by_category(@p_from, @p_to, @p_shop_ids, @p_inv_ids, @p_cat_ids)";
        var rows = await conn.QueryAsync<AccountsCategoryRow>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<AccountsProductRow>> GetTopProductsAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        int limit,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_top_products(@p_from, @p_to, @p_shop_ids, @p_inv_ids, @p_cat_ids, @p_limit)";
        var rows = await conn.QueryAsync<AccountsProductRow>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
                p_limit    = limit,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<AccountsAdjustmentRow>> GetAdjustmentsAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds, Guid[]? inventoryIds, int[]? categoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_adjustments(@p_from, @p_to, @p_shop_ids, @p_inv_ids, @p_cat_ids)";
        var rows = await conn.QueryAsync<AccountsAdjustmentRow>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
                p_cat_ids  = categoryIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<AccountsInTransit> GetInTransitAsync(
        Guid[]? shopIds, Guid[]? inventoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_in_transit(@p_shop_ids, @p_inv_ids)";
        return await conn.QuerySingleAsync<AccountsInTransit>(new CommandDefinition(
            sql,
            new
            {
                p_shop_ids = shopIds,
                p_inv_ids  = inventoryIds,
            },
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<AccountsUtilityRow>> GetUtilitiesAsync(
        DateOnly from, DateOnly to,
        Guid[]? shopIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_utilities_breakdown(@p_from, @p_to, @p_shop_ids)";
        var rows = await conn.QueryAsync<AccountsUtilityRow>(new CommandDefinition(
            sql,
            new
            {
                p_from     = from,
                p_to       = to,
                p_shop_ids = shopIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<decimal> GetGodownExpensesAsync(
        DateOnly from, DateOnly to,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_accounts_godown_expenses(@p_from, @p_to)";
        return await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(
            sql, new { p_from = from, p_to = to }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<AccountsInventoryExpenseRow>> GetInventoryExpensesAsync(
        DateOnly from, DateOnly to,
        Guid[]? inventoryIds,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_accounts_inventory_expenses_breakdown(@p_from, @p_to, @p_inventory_ids)";
        var rows = await conn.QueryAsync<AccountsInventoryExpenseRow>(new CommandDefinition(
            sql,
            new
            {
                p_from          = from,
                p_to            = to,
                p_inventory_ids = inventoryIds,
            },
            cancellationToken: ct));
        return rows.ToList();
    }
}
