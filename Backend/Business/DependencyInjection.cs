using System.Text;
using FluentValidation;
using KovilpattiSnacks.Business.Implementation;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Business.Settings;
using KovilpattiSnacks.Repository;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace KovilpattiSnacks.Business;

public static class DependencyInjection
{
    public static IServiceCollection AddBusiness(this IServiceCollection services, IConfiguration config)
    {
        // Repository (Dapper + stored functions)
        services.AddRepository(config);

        // Validators (auto-discover from this assembly)
        services.AddValidatorsFromAssembly(typeof(DependencyInjection).Assembly);

        // Settings
        services.Configure<JwtSettings>(config.GetSection(JwtSettings.SectionName));

        // Identity helpers
        services.AddSingleton<IPasswordHasher, BCryptPasswordHasher>();
        services.AddScoped<IJwtTokenGenerator, JwtTokenGenerator>();

        // Current user (HttpContext-backed)
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, CurrentUserService>();

        // Business services
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IInventoryService, InventoryService>();
        services.AddScoped<IShopService, ShopService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<ICategoryService, CategoryService>();

        // JWT bearer authentication
        var jwt = config.GetSection(JwtSettings.SectionName).Get<JwtSettings>()
            ?? throw new InvalidOperationException("Jwt settings missing.");

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(opts =>
            {
                opts.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwt.Issuer,
                    ValidAudience = jwt.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
                    ClockSkew = TimeSpan.FromMinutes(2)
                };
            });

        services.AddAuthorization();

        return services;
    }
}
