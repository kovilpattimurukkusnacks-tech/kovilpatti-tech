using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class UserRepository(IDbConnectionFactory factory) : IUserRepository
{
    public async Task<User?> FindByUsernameAsync(string username, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_user_find_by_username(@p_username)";
        return await conn.QuerySingleOrDefaultAsync<User>(
            new CommandDefinition(sql, new { p_username = username }, cancellationToken: ct));
    }

    public async Task<bool> AnyAdminAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_user_any_admin()";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, cancellationToken: ct));
    }

    public async Task<Guid> CreateAsync(User user, Guid? createdBy, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_user_create(
                @p_username, @p_password_hash, @p_full_name,
                @p_role::user_role,
                @p_shop_id, @p_inventory_id, @p_created_by)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_username      = user.Username,
            p_password_hash = user.PasswordHash,
            p_full_name     = user.FullName,
            p_role          = ToPgRole(user.Role),
            p_shop_id       = user.ShopId,
            p_inventory_id  = user.InventoryId,
            p_created_by    = createdBy
        }, cancellationToken: ct));
    }

    public async Task<List<User>> ListStaffAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_user_list()";
        var rows = await conn.QueryAsync<User>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<(List<User> Rows, long Total)> ListStaffPagedAsync(int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList  = "SELECT * FROM fn_user_list_paged(@p_page, @p_page_size)";
        const string sqlCount = "SELECT fn_user_count()";

        var rows = (await conn.QueryAsync<User>(new CommandDefinition(
            sqlList, new { p_page = page, p_page_size = pageSize }, cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(sqlCount, cancellationToken: ct));

        return (rows, total);
    }

    public async Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_user_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<User>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> UsernameExistsAsync(string username, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_user_username_exists(@p_username)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_username = username }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(User user, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_user_update(
                @p_id, @p_full_name,
                @p_role::user_role,
                @p_shop_id, @p_inventory_id, @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id           = user.Id,
            p_full_name    = user.FullName,
            p_role         = ToPgRole(user.Role),
            p_shop_id      = user.ShopId,
            p_inventory_id = user.InventoryId,
            p_active       = user.Active,
            p_user_id      = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdatePasswordAsync(Guid id, string passwordHash, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_user_password_update(@p_id, @p_password_hash, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id            = id,
            p_password_hash = passwordHash,
            p_user_id       = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_user_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }

    private static string ToPgRole(UserRole r) => r switch
    {
        UserRole.Admin     => "admin",
        UserRole.ShopUser  => "shop_user",
        UserRole.Inventory => "inventory",
        _ => throw new ArgumentOutOfRangeException(nameof(r))
    };
}
