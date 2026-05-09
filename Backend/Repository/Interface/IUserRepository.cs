using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IUserRepository
{
    Task<User?> FindByUsernameAsync(string username, CancellationToken ct = default);
    Task<bool> AnyAdminAsync(CancellationToken ct = default);
    Task<Guid> CreateAsync(User user, Guid? createdBy, CancellationToken ct = default);

    Task<List<User>> ListStaffAsync(CancellationToken ct = default);
    Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<bool> UsernameExistsAsync(string username, CancellationToken ct = default);
    Task<bool> UpdateAsync(User user, Guid userId, CancellationToken ct = default);
    Task<bool> UpdatePasswordAsync(Guid id, string passwordHash, Guid userId, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(Guid id, Guid userId, CancellationToken ct = default);
}
