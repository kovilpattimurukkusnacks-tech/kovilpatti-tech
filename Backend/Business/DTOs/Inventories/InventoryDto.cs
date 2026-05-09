namespace KovilpattiSnacks.Business.DTOs.Inventories;

public record InventoryDto(
    Guid Id,
    string Code,
    string Name,
    string Address,
    string ContactPhone,
    string? ContactPersonName,
    bool Active
);
