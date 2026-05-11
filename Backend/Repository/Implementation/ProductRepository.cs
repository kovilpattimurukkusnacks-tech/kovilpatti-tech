using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class ProductRepository(IDbConnectionFactory factory) : IProductRepository
{
    public async Task<List<Product>> ListAsync(string? search, int? categoryId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_product_list(@p_search, @p_category_id)";
        var rows = await conn.QueryAsync<Product>(
            new CommandDefinition(sql, new { p_search = search, p_category_id = categoryId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<(List<Product> Rows, long Total)> ListPagedAsync(
        string? search, int? categoryId, int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);

        const string sqlList  = "SELECT * FROM fn_product_list_paged(@p_search, @p_category_id, @p_page, @p_page_size)";
        const string sqlCount = "SELECT fn_product_count(@p_search, @p_category_id)";

        var rows = (await conn.QueryAsync<Product>(new CommandDefinition(
            sqlList,
            new { p_search = search, p_category_id = categoryId, p_page = page, p_page_size = pageSize },
            cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            sqlCount,
            new { p_search = search, p_category_id = categoryId },
            cancellationToken: ct));

        return (rows, total);
    }

    public async Task<Product?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_product_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<Product>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<bool> ExistsByCodeAsync(string code, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_product_exists_by_code(@p_code)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_code = code }, cancellationToken: ct));
    }

    public async Task<string> NextCodeAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_product_next_code()";
        return await conn.ExecuteScalarAsync<string>(new CommandDefinition(sql, cancellationToken: ct)) ?? "P001";
    }

    public async Task<Guid> CreateAsync(Product product, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_product_create(
                @p_code, @p_name, @p_category_id, @p_type,
                @p_weight_value, @p_weight_unit, @p_mrp, @p_purchase_price,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_code           = product.Code,
            p_name           = product.Name,
            p_category_id    = product.CategoryId,
            p_type           = product.Type,
            p_weight_value   = product.WeightValue,
            p_weight_unit    = product.WeightUnit,
            p_mrp            = product.Mrp,
            p_purchase_price = product.PurchasePrice,
            p_active         = product.Active,
            p_user_id        = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> UpdateAsync(Product product, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_product_update(
                @p_id, @p_name, @p_category_id, @p_type,
                @p_weight_value, @p_weight_unit, @p_mrp, @p_purchase_price,
                @p_active, @p_user_id)";

        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id             = product.Id,
            p_name           = product.Name,
            p_category_id    = product.CategoryId,
            p_type           = product.Type,
            p_weight_value   = product.WeightValue,
            p_weight_unit    = product.WeightUnit,
            p_mrp            = product.Mrp,
            p_purchase_price = product.PurchasePrice,
            p_active         = product.Active,
            p_user_id        = userId
        }, cancellationToken: ct));
    }

    public async Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_product_soft_delete(@p_id, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(sql, new { p_id = id, p_user_id = userId }, cancellationToken: ct));
    }
}
