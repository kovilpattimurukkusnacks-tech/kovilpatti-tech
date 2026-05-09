using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class InventoryRepository(IDbConnectionFactory factory) : IInventoryRepository
{
    public async Task<List<Inventory>> ListAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_list()";
        var rows = await conn.QueryAsync<Inventory>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<Inventory?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_inventory_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<Inventory>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_inventory_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_inventory_exists_by_code(@p_code)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_code = code }, cancellationToken: ct));
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_inventory_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct)) ?? "INV001";
    }

    public async Task<Guid> CreateAsync(Inventory inventory, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_inventory_create(
                @p_code, @p_name, @p_address,
                @p_contact_phone, @p_contact_person_name,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code                = inventory.Code,
            p_name                = inventory.Name,
            p_address             = inventory.Address,
            p_contact_phone       = inventory.ContactPhone,
            p_contact_person_name = inventory.ContactPersonName,
            p_active              = inventory.Active,
            p_user_id             = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(Inventory inventory, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_inventory_update(
                @p_id, @p_name, @p_address,
                @p_contact_phone, @p_contact_person_name,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id                  = inventory.Id,
            p_name                = inventory.Name,
            p_address             = inventory.Address,
            p_contact_phone       = inventory.ContactPhone,
            p_contact_person_name = inventory.ContactPersonName,
            p_active              = inventory.Active,
            p_user_id             = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_inventory_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
