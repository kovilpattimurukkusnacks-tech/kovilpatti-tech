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
        services.AddSingleton<IDbConnectionFactory, NpgsqlConnectionFactory>();

        // Dapper: snake_case columns → PascalCase properties
        DefaultTypeMap.MatchNamesWithUnderscores = true;

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IProductRepository, ProductRepository>();
        services.AddScoped<ICategoryRepository, CategoryRepository>();
        services.AddScoped<IInventoryRepository, InventoryRepository>();
        services.AddScoped<IShopRepository, ShopRepository>();

        return services;
    }
}
