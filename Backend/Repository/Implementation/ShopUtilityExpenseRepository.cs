using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class ShopUtilityExpenseRepository(IDbConnectionFactory factory) : IShopUtilityExpenseRepository
{
    public async Task<List<ShopUtilityExpense>> ListAsync(
        Guid shopId, DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_utility_expense_list(@p_shop_id, @p_from_date, @p_to_date)";
        var rows = await conn.QueryAsync<ShopUtilityExpense>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_from_date = fromDate, p_to_date = toDate }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<ShopUtilityExpense?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_utility_expense_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<ShopUtilityExpense>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    // Both _create and _update now return the full row directly (via
    // RETURNING in the SP) instead of just an id/bool, so the service no
    // longer needs a second round trip to fetch it back afterward.
    public async Task<ShopUtilityExpense> CreateAsync(
        Guid shopId, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_utility_expense_create(@p_shop_id, @p_category, @p_amount, @p_note, @p_expense_date, @p_user_id)";
        return await conn.QuerySingleAsync<ShopUtilityExpense>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_category = category, p_amount = amount,
            p_note = note, p_expense_date = expenseDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<ShopUtilityExpense?> UpdateAsync(
        Guid id, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_utility_expense_update(@p_id, @p_category, @p_amount, @p_note, @p_expense_date, @p_user_id)";
        return await conn.QuerySingleOrDefaultAsync<ShopUtilityExpense>(new CommandDefinition(sql, new
        {
            p_id = id, p_category = category, p_amount = amount,
            p_note = note, p_expense_date = expenseDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_utility_expense_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
