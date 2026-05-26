using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using KovilpattiSnacks.Business.Constants;
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
        var issuedAt  = DateTimeOffset.UtcNow;
        var expiresAt = issuedAt.AddMinutes(_settings.ExpiryMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            // iat is required for any future "invalidate tokens older than X"
            // policy (e.g., on password change). Without it, there's no anchor.
            new(JwtRegisteredClaimNames.Iat, issuedAt.ToUnixTimeSeconds().ToString(),
                ClaimValueTypes.Integer64),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new(ClaimTypes.Role, user.Role.ToString()),
            new(CustomClaims.FullName, user.FullName),
        };

        if (user.ShopId.HasValue)
            claims.Add(new Claim(CustomClaims.ShopId, user.ShopId.Value.ToString()));

        if (user.InventoryId.HasValue)
            claims.Add(new Claim(CustomClaims.InventoryId, user.InventoryId.Value.ToString()));

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
