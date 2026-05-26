using System.Security.Claims;
using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Http;

namespace KovilpattiSnacks.Business.Implementation;

public class CurrentUserService(IHttpContextAccessor accessor) : ICurrentUser
{
    // JWT bearer middleware auto-maps the "sub" claim to ClaimTypes.NameIdentifier
    // (MapInboundClaims = true by default), so reading the mapped key is enough.
    public Guid? UserId
    {
        get
        {
            var sub = accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(sub, out var id) ? id : null;
        }
    }

    public string? Role => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.Role);

    public bool IsAuthenticated => accessor.HttpContext?.User.Identity?.IsAuthenticated == true;

    public Guid? ShopId
    {
        get
        {
            var raw = accessor.HttpContext?.User.FindFirstValue(CustomClaims.ShopId);
            return Guid.TryParse(raw, out var id) ? id : null;
        }
    }

    public Guid? InventoryId
    {
        get
        {
            var raw = accessor.HttpContext?.User.FindFirstValue(CustomClaims.InventoryId);
            return Guid.TryParse(raw, out var id) ? id : null;
        }
    }
}
