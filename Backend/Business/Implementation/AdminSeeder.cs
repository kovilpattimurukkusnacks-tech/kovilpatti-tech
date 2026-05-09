using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// One-time bootstrap of the admin row if no admin exists.
/// Called from API Program.cs in Development.
/// </summary>
public static class AdminSeeder
{
    public static async Task SeedAsync(
        IUserRepository users,
        IPasswordHasher hasher,
        string username,
        string password,
        string fullName,
        CancellationToken ct = default)
    {
        if (await users.AnyAdminAsync(ct)) return;

        var admin = new User
        {
            Username     = username,
            PasswordHash = hasher.Hash(password),
            FullName     = fullName,
            Role         = UserRole.Admin,
            Active       = true,
        };

        await users.CreateAsync(admin, createdBy: null, ct);
    }
}
