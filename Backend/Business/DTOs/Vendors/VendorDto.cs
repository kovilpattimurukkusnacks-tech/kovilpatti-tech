namespace KovilpattiSnacks.Business.DTOs.Vendors;

public record VendorDto(
    Guid Id,
    string Code,
    string Name,
    string? Gstin,
    string? StateCode,
    string? Address,
    string? ContactPerson,
    string? ContactPhone,
    string? Email,
    bool Active,
    // Derived, not stored — vendors.state_code <> '33' (Tamil Nadu). Same
    // rule vendor_purchases.is_interstate uses at insert time; surfaced
    // here so the Vendor screen can preview it before any purchase exists.
    bool IsInterstate
);
