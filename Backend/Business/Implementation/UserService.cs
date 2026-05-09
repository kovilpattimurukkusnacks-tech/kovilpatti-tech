using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs.Users;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class UserService(
    IUserRepository users,
    IShopRepository shops,
    IInventoryRepository inventories,
    IPasswordHasher hasher,
    ICurrentUser currentUser,
    IValidator<CreateStaffRequest> createValidator,
    IValidator<UpdateStaffRequest> updateValidator,
    IValidator<ResetPasswordRequest> resetValidator
) : IUserService
{
    public async Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await users.ListStaffAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<UserDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var u = await users.GetByIdAsync(id, ct)
            ?? throw new NotFoundException($"User '{id}' not found.");
        return MapToDto(u);
    }

    public async Task<UserDto> CreateAsync(CreateStaffRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var role = ParseRole(request.Role);

        if (role == UserRole.ShopUser)
        {
            if (!await shops.ExistsAsync(request.ShopId!.Value, ct))
                throw new NotFoundException($"Shop '{request.ShopId}' not found.");
        }
        else
        {
            if (!await inventories.ExistsAsync(request.InventoryId!.Value, ct))
                throw new NotFoundException($"Inventory '{request.InventoryId}' not found.");
        }

        var username = request.Username.Trim();
        if (await users.UsernameExistsAsync(username, ct))
            throw new ValidationException(new[]
            {
                new ValidationFailure(nameof(request.Username), $"Username '{username}' already exists.")
            });

        var creator = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var newUser = new User
        {
            Username     = username,
            PasswordHash = hasher.Hash(request.Password),
            FullName     = request.FullName.Trim(),
            Role         = role,
            ShopId       = role == UserRole.ShopUser ? request.ShopId : null,
            InventoryId  = role == UserRole.Inventory ? request.InventoryId : null,
            Active       = request.Active
        };

        var newId = await users.CreateAsync(newUser, creator, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<UserDto> UpdateAsync(Guid id, UpdateStaffRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await users.GetByIdAsync(id, ct)
            ?? throw new NotFoundException($"User '{id}' not found.");

        if (existing.Role == UserRole.Admin)
            throw new ForbiddenException("Cannot modify the admin user via this endpoint.");

        var role = ParseRole(request.Role);

        if (role == UserRole.ShopUser)
        {
            if (!await shops.ExistsAsync(request.ShopId!.Value, ct))
                throw new NotFoundException($"Shop '{request.ShopId}' not found.");
        }
        else
        {
            if (!await inventories.ExistsAsync(request.InventoryId!.Value, ct))
                throw new NotFoundException($"Inventory '{request.InventoryId}' not found.");
        }

        var updater = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new User
        {
            Id           = id,
            FullName     = request.FullName.Trim(),
            Role         = role,
            ShopId       = role == UserRole.ShopUser ? request.ShopId : null,
            InventoryId  = role == UserRole.Inventory ? request.InventoryId : null,
            Active       = request.Active
        };

        var ok = await users.UpdateAsync(updated, updater, ct);
        if (!ok) throw new NotFoundException($"User '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task ResetPasswordAsync(Guid id, ResetPasswordRequest request, CancellationToken ct = default)
    {
        var validation = await resetValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await users.GetByIdAsync(id, ct)
            ?? throw new NotFoundException($"User '{id}' not found.");

        if (existing.Role == UserRole.Admin)
            throw new ForbiddenException("Cannot reset the admin user's password via this endpoint.");

        var updater = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var hash = hasher.Hash(request.NewPassword);
        var ok = await users.UpdatePasswordAsync(id, hash, updater, ct);
        if (!ok) throw new NotFoundException($"User '{id}' not found.");
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var existing = await users.GetByIdAsync(id, ct)
            ?? throw new NotFoundException($"User '{id}' not found.");

        if (existing.Role == UserRole.Admin)
            throw new ForbiddenException("Cannot delete the admin user via this endpoint.");

        var updater = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await users.SoftDeleteAsync(id, updater, ct);
        if (!ok) throw new NotFoundException($"User '{id}' not found.");
    }

    private static UserRole ParseRole(string role) => role switch
    {
        "ShopUser"  => UserRole.ShopUser,
        "Inventory" => UserRole.Inventory,
        _ => throw new ValidationException(new[]
            {
                new ValidationFailure("Role", $"Unknown role '{role}'. Must be 'ShopUser' or 'Inventory'.")
            })
    };

    private static UserDto MapToDto(User u) => new(
        Id:            u.Id,
        Username:      u.Username,
        FullName:      u.FullName,
        Role:          u.Role.ToString(),
        ShopId:        u.ShopId,
        ShopName:      u.ShopName,
        InventoryId:   u.InventoryId,
        InventoryName: u.InventoryName,
        Active:        u.Active
    );
}
