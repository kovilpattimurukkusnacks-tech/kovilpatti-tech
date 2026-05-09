using System.Security.Claims;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Http;

namespace KovilpattiSnacks.Business.Implementation;

public class CurrentUserService(IHttpContextAccessor accessor) : ICurrentUser
{
    public Guid? UserId
    {
        get
        {
            var sub = accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? accessor.HttpContext?.User.FindFirstValue("sub");
            return Guid.TryParse(sub, out var id) ? id : null;
        }
    }

    public string? Role => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.Role);

    public bool IsAuthenticated => accessor.HttpContext?.User.Identity?.IsAuthenticated == true;
}
