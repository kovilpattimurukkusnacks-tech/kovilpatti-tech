using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Business.Settings;
using KovilpattiSnacks.Repository.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace KovilpattiSnacks.Business.Implementation;

public class JwtTokenGenerator(IOptions<JwtSettings> options) : IJwtTokenGenerator
{
    private readonly JwtSettings _settings = options.Value;

    public (string Token, DateTimeOffset ExpiresAt) Generate(User user)
    {
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_settings.ExpiryMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new(ClaimTypes.Role, user.Role.ToString()),
            new("fullName", user.FullName),
        };

        if (user.ShopId.HasValue)
            claims.Add(new Claim("shopId", user.ShopId.Value.ToString()));

        if (user.InventoryId.HasValue)
            claims.Add(new Claim("inventoryId", user.InventoryId.Value.ToString()));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.SigningKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            expires: expiresAt.UtcDateTime,
            signingCredentials: creds);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
