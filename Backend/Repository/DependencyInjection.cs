using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Implementation;
using KovilpattiSnacks.Repository.Interface;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace KovilpattiSnacks.Repository;

public static class DependencyInjection
{
    public static IServiceCollection AddRepository(this IServiceCollection services, IConfiguration config)
    {
        var connStr = config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("Connection string 'Default' is missing.");

        var dsBuilder = new NpgsqlDataSourceBuilder(connStr);
        dsBuilder.MapEnum<UserRole>("user_role");
        var dataSource = dsBuilder.Build();

        services.AddSingleton(dataSource);
        // Scoped (not singleton) because the factory now depends on the
        // request-scoped ICorrelationIdAccessor to tag application_name
        // on each connection. Cost is negligible — factory is stateless
        // apart from the accessor reference.
        services.AddScoped<IDbConnectionFactory, NpgsqlConnectionFactory>();

        // Dapper: snake_case columns → PascalCase properties
        DefaultTypeMap.MatchNamesWithUnderscores = true;

        // Dapper can't bind System.DateOnly out of the box (this version) — teach
        // it to send DateOnly params as PostgreSQL `date`. Used by the stock
        // request date-range filter (p_from_date / p_to_date).
        SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IProductRepository, ProductRepository>();
        services.AddScoped<ICategoryRepository, CategoryRepository>();
        services.AddScoped<IInventoryRepository, InventoryRepository>();
        services.AddScoped<IShopRepository, ShopRepository>();

        // Phase 2
        services.AddScoped<IAppSettingRepository, AppSettingRepository>();
        services.AddScoped<IStockRequestRepository, StockRequestRepository>();

        // Phase 3 — accounts reporting (read-only)
        services.AddScoped<IAccountsRepository, AccountsRepository>();

        // Phase 4 — shop utility / operating expenses
        services.AddScoped<IShopUtilityExpenseRepository, ShopUtilityExpenseRepository>();

        // Phase 4 — shop inventory + stock-take
        services.AddScoped<IShopInventoryRepository, ShopInventoryRepository>();

        // Phase 4 — POS billing
        services.AddScoped<IBillRepository, BillRepository>();

        return services;
    }
}
