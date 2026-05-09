using KovilpattiSnacks.Business.DTOs.Categories;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Business.Implementation;

public class CategoryService(ICategoryRepository categories) : ICategoryService
{
    public async Task<IReadOnlyList<CategoryDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await categories.ListAsync(ct);
        return rows.Select(c => new CategoryDto(c.Id, c.Name, c.Active)).ToList();
    }
}
