using KovilpattiSnacks.Business.DTOs.Categories;

namespace KovilpattiSnacks.Business.Interface;

public interface ICategoryService
{
    Task<IReadOnlyList<CategoryDto>> ListAsync(CancellationToken ct = default);
}
