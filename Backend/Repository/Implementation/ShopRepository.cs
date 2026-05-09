using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class ShopRepository(IDbConnectionFactory factory) : IShopRepository
{
    public async Task<List<Shop>> ListAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_list()";
        var rows = await conn.QueryAsync<Shop>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<Shop?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_shop_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<Shop>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_exists_by_code(@p_code)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_code = code }, cancellationToken: ct));
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct)) ?? "SHP001";
    }

    public async Task<Guid> CreateAsync(Shop shop, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_shop_create(
                @p_code, @p_name, @p_address,
                @p_contact_phone_1, @p_contact_phone_2, @p_gstin,
                @p_inventory_id, @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code            = shop.Code,
            p_name            = shop.Name,
            p_address         = shop.Address,
            p_contact_phone_1 = shop.ContactPhone1,
            p_contact_phone_2 = shop.ContactPhone2,
            p_gstin           = shop.Gstin,
            p_inventory_id    = shop.InventoryId,
            p_active          = shop.Active,
            p_user_id         = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(Shop shop, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_shop_update(
                @p_id, @p_name, @p_address,
                @p_contact_phone_1, @p_contact_phone_2, @p_gstin,
                @p_inventory_id, @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id              = shop.Id,
            p_name            = shop.Name,
            p_address         = shop.Address,
            p_contact_phone_1 = shop.ContactPhone1,
            p_contact_phone_2 = shop.ContactPhone2,
            p_gstin           = shop.Gstin,
            p_inventory_id    = shop.InventoryId,
            p_active          = shop.Active,
            p_user_id         = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_shop_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
