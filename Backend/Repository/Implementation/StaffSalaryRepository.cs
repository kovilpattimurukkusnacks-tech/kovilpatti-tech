using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class StaffSalaryRepository(IDbConnectionFactory factory) : IStaffSalaryRepository
{
    public async Task<List<StaffSalaryRow>> GetAllAsync(DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_get_all(@p_from, @p_to)";
        var rows = await conn.QueryAsync<StaffSalaryRow>(new CommandDefinition(
            sql, new { p_from = from, p_to = to }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<StaffSalary> SetAsync(
        Guid staffId, decimal monthlyAmount, DateOnly effectiveFrom, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_set(@p_staff_id, @p_monthly_amount, @p_effective_from, @p_user_id)";
        return await conn.QuerySingleAsync<StaffSalary>(new CommandDefinition(sql, new
        {
            p_staff_id = staffId, p_monthly_amount = monthlyAmount,
            p_effective_from = effectiveFrom, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<StaffSalaryShopTransaction> CreateShopTxnAsync(
        Guid shopId, Guid staffId, decimal amount, string? note, DateOnly txnDate, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_shop_txn_create(@p_shop_id, @p_staff_id, @p_amount, @p_note, @p_txn_date, @p_user_id)";
        return await conn.QuerySingleAsync<StaffSalaryShopTransaction>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_staff_id = staffId, p_amount = amount,
            p_note = note, p_txn_date = txnDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<StaffSalaryOtherTransaction> CreateOtherTxnAsync(
        Guid staffId, decimal amount, string? reason, string? note, DateOnly txnDate, Guid userId,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_other_txn_create(@p_staff_id, @p_amount, @p_reason, @p_note, @p_txn_date, @p_user_id)";
        return await conn.QuerySingleAsync<StaffSalaryOtherTransaction>(new CommandDefinition(sql, new
        {
            p_staff_id = staffId, p_amount = amount, p_reason = reason,
            p_note = note, p_txn_date = txnDate, p_user_id = userId,
        }, cancellationToken: ct));
    }

    public async Task<bool> HasMonthlySalaryAsync(Guid staffId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_staff_salary_exists(@p_staff_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_staff_id = staffId }, cancellationToken: ct));
    }

    public async Task<List<StaffSalaryTransaction>> GetTransactionsAsync(
        Guid staffId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_transactions_list(@p_staff_id, @p_from, @p_to)";
        var rows = await conn.QueryAsync<StaffSalaryTransaction>(new CommandDefinition(
            sql, new { p_staff_id = staffId, p_from = from, p_to = to }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<StaffSalaryTransaction?> GetLastBonusAsync(Guid staffId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_staff_salary_last_bonus(@p_staff_id)";
        return await conn.QuerySingleOrDefaultAsync<StaffSalaryTransaction>(
            new CommandDefinition(sql, new { p_staff_id = staffId }, cancellationToken: ct));
    }
}
