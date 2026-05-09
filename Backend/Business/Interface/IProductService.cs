using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Interface;

public interface IProductService
{
    Task<IReadOnlyList<ProductDto>> ListAsync(string? search, int? categoryId, CancellationToken ct = default);
    Task<ProductDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<ProductDto> CreateAsync(CreateProductRequest request, CancellationToken ct = default);
    Task<ProductDto> UpdateAsync(Guid id, UpdateProductRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task<ImportProductsResult> ImportAsync(Stream fileStream, string fileName, CancellationToken ct = default);
}
