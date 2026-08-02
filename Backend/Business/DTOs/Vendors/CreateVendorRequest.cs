namespace KovilpattiSnacks.Business.DTOs.Vendors;

public record CreateVendorRequest(
    string Name,
    string? Gstin,
    string StateCode,
    string? Address,
    string? ContactPerson,
    string? ContactPhone,
    string? Email,
    bool Active = true
);
