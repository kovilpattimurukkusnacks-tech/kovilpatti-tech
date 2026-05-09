using KovilpattiSnacks.Business.DTOs.Inventories;

namespace KovilpattiSnacks.Business.Interface;

public interface IInventoryService
{
    Task<IReadOnlyList<InventoryDto>> ListAsync(CancellationToken ct = default);
    Task<InventoryDto> GetAsync(Guid id, CancellationToken ct = default);
    Task<InventoryDto> CreateAsync(CreateInventoryRequest request, CancellationToken ct = default);
    Task<InventoryDto> UpdateAsync(Guid id, UpdateInventoryRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}
