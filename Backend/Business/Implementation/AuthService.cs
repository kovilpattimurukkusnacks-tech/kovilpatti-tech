using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Auth;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class AuthService(
    IUserRepository users,
    IPasswordHasher hasher,
    IJwtTokenGenerator tokenGen,
    IValidator<LoginRequest> validator
) : IAuthService
{
    public async Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var user = await users.FindByUsernameAsync(request.Username, ct);

        if (user is null || !hasher.Verify(request.Password, user.PasswordHash))
            throw new UnauthorizedException("Invalid username or password.");

        var (token, expiresAt) = tokenGen.Generate(user);

        return new LoginResponse(
            Token: token,
            ExpiresAt: expiresAt,
            UserId: user.Id,
            Username: user.Username,
            FullName: user.FullName,
            Role: user.Role.ToString(),
            ShopId: user.ShopId,
            InventoryId: user.InventoryId
        );
    }
}
