namespace KovilpattiSnacks.Business.DTOs.StockRequests;

/// Shop declares (or clears) the "Special Request" flag on a Pending request.
/// Client asked for this on the review/submit step — the shop marks the whole
/// request as vendor-procured up-front so the godown can source from a vendor
/// rather than pack from on-hand stock (06-Jul-2026).
///
/// SpecialLabel is optional — a user-supplied name like "Diwali stock 2026".
/// When IsSpecial is false, any label is discarded (the DB enforces this via
/// chk_special_label_only_when_special).
///
/// Once the request reaches Approved, the SP-side gate freezes the flag —
/// the service raises a 4xx on later attempts to change it.
public record SetSpecialRequest(
    bool    IsSpecial,
    string? SpecialLabel
);
