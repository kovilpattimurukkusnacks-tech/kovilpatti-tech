namespace KovilpattiSnacks.Business.DTOs.Inventories;

public record CreateInventoryRequest(
    string? Code,
    string Name,
    string Address,
    string ContactPhone,
    string? ContactPersonName,
    bool Active = true
);
