namespace KovilpattiSnacks.Business.DTOs.Inventories;

public record UpdateInventoryRequest(
    string Name,
    string Address,
    string ContactPhone,
    string? ContactPersonName,
    bool Active
);
