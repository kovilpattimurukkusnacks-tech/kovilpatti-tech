using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Interface;

public interface IProductService
{
    Task<PagedResult<ProductDto>> ListAsync(
        string? search,
        int[]? categoryIds,
        string[]? types,
        int page,
        int pageSize,
        // 21-Jul-2026: admin-only opt-in. When true, inactive products are
        // returned too — needed by the admin management page so it can
        // still reactivate them. Non-admin callers pass false (or omit).
        // Service ignores the flag when caller isn't admin — defence
        // against a rogue shop/inventory client sending includeInactive=true.
        bool includeInactive = false,
        CancellationToken ct = default);
    Task<ProductDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<ProductDto> CreateAsync(CreateProductRequest request, CancellationToken ct = default);
    Task<ProductDto> UpdateAsync(Guid id, UpdateProductRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<ImportProductsResult> ImportAsync(Stream fileStream, string fileName, CancellationToken ct = default);
}
