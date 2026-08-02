namespace KovilpattiSnacks.Business.DTOs.EwayBills;

/// One e-way bill row, either as a list-item (attached to a purchase) or a
/// singleton (fetched by id). Same shape from both endpoints — Phase 5b only
/// writes Inbound, so outbound parent FKs stay null.
public record EwayBillDto(
    Guid Id,
    string EwayNumber,
    DateTimeOffset? GenerationDate,
    /// "Inbound" | "Outbound". Phase 5b writes only "Inbound".
    string Direction,
    Guid? VendorPurchaseId,
    Guid? StockRequestId,
    Guid? BillId,
    string? DocumentNumber,
    DateOnly? DocumentDate,
    string? FromGstin,
    string? FromStateCode,
    string? ToGstin,
    string? ToStateCode,
    string? TransportMode,
    short?  DistanceKm,
    string? TransporterName,
    string? VehicleNumber,
    decimal? TaxableAmount,
    decimal  CgstAmount,
    decimal  SgstAmount,
    decimal  IgstAmount,
    decimal? TotalAmount,
    DateTimeOffset? ValidFrom,
    DateTimeOffset? ValidUntil,
    /// "Draft" | "Generated" | "Cancelled" | "Expired". Phase 5b writes only "Generated".
    string Status,
    /// "Manual" | "API". Phase 5b writes only "Manual".
    string GeneratedVia,
    string? AttachmentUrl,
    string? Notes,
    DateTimeOffset CreatedAt
);
