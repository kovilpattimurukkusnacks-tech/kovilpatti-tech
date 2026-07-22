using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class InventoryExpenseRepository(IDbConnectionFactory factory) : IInventoryExpenseRepository
{
    public async Task<List<InventoryExpense>> ListAsync(
        Guid inventoryId, DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_expense_list(@p_inventory_id, @p_from_date, @p_to_date)";
        var rows = await conn.QueryAsync<InventoryExpense>(new CommandDefinition(
            sql, new { p_inventory_id = inventoryId, p_from_date = fromDate, p_to_date = toDate }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<InventoryExpense?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_expense_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<InventoryExpense>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<InventoryExpense> CreateAsync(
        Guid inventoryId, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_expense_create(@p_inventory_id, @p_category, @p_amount, @p_note, @p_expense_date, @p_user_id)";
        return await conn.QuerySingleAsync<InventoryExpense>(new CommandDefinition(sql, new
        {
            p_inventory_id = inventoryId, p_category = category, p_amount = amount,
            p_note = note, p_expense_date = expenseDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<InventoryExpense?> UpdateAsync(
        Guid id, string category, decimal amount, string? note, DateOnly expenseDate,
        Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_expense_update(@p_id, @p_category, @p_amount, @p_note, @p_expense_date, @p_user_id)";
        return await conn.QuerySingleOrDefaultAsync<InventoryExpense>(new CommandDefinition(sql, new
        {
            p_id = id, p_category = category, p_amount = amount,
            p_note = note, p_expense_date = expenseDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_inventory_expense_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
