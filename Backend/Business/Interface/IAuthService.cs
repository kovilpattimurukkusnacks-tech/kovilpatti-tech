using KovilpattiSnacks.Business.DTOs.Auth;

namespace KovilpattiSnacks.Business.Interface;

public interface IAuthService
{
    Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken ct = default);
}
