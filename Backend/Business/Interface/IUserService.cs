using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Users;

namespace KovilpattiSnacks.Business.Interface;

public interface IUserService
{
    Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken ct = default);
    Task<PagedResult<UserDto>> ListPagedAsync(int page, int pageSize, CancellationToken ct = default);
    Task<UserDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<UserDto> CreateAsync(CreateStaffRequest request, CancellationToken ct = default);
    Task<UserDto> UpdateAsync(Guid id, UpdateStaffRequest request, CancellationToken ct = default);
    Task ResetPasswordAsync(Guid id, ResetPasswordRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
