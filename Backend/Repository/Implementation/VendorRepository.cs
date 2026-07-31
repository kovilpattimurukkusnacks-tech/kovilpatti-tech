using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class VendorRepository(IDbConnectionFactory factory) : IVendorRepository
{
    public async Task<List<Vendor>> ListAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_vendor_list()";
        var rows = await conn.QueryAsync<Vendor>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<(List<Vendor> Rows, long Total)> ListPagedAsync(
        int page, int pageSize, string? search = null, bool? active = null, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList  = "SELECT * FROM fn_vendor_list_paged(@p_page, @p_page_size, @p_search, @p_active)";
        const string sqlCount = "SELECT fn_vendor_count(@p_search, @p_active)";

        var rows = (await conn.QueryAsync<Vendor>(new CommandDefinition(
            sqlList, new { p_page = page, p_page_size = pageSize, p_search = search, p_active = active }, cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            sqlCount, new { p_search = search, p_active = active }, cancellationToken: ct));

        return (rows, total);
    }

    public async Task<Vendor?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_vendor_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<Vendor>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_exists(@p_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_exists_by_code(@p_code)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_code = code }, cancellationToken: ct));
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct)) ?? "VEN0001";
    }

    public async Task<Guid> CreateAsync(Vendor vendor, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_vendor_create(
                @p_code, @p_name, @p_gstin, @p_state_code,
                @p_address, @p_contact_person, @p_contact_phone, @p_email,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code           = vendor.Code,
            p_name           = vendor.Name,
            p_gstin          = vendor.Gstin,
            p_state_code     = vendor.StateCode,
            p_address        = vendor.Address,
            p_contact_person = vendor.ContactPerson,
            p_contact_phone  = vendor.ContactPhone,
            p_email          = vendor.Email,
            p_active         = vendor.Active,
            p_user_id        = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(Vendor vendor, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_vendor_update(
                @p_id, @p_name, @p_gstin, @p_state_code,
                @p_address, @p_contact_person, @p_contact_phone, @p_email,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id             = vendor.Id,
            p_name           = vendor.Name,
            p_gstin          = vendor.Gstin,
            p_state_code     = vendor.StateCode,
            p_address        = vendor.Address,
            p_contact_person = vendor.ContactPerson,
            p_contact_phone  = vendor.ContactPhone,
            p_email          = vendor.Email,
            p_active         = vendor.Active,
            p_user_id        = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_vendor_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
