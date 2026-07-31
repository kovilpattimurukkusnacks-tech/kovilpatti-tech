namespace KovilpattiSnacks.Business.DTOs.EwayBills;

/// Phase 5b — Inbound e-way bill record request. Only the fields we let the
/// user key in from the AdminPurchaseNew e-way section; everything else on
/// eway_bills is either SP-supplied ('Inward'/'Supply'/'TaxInvoice',
/// direction='Inbound', status='Generated', generated_via='Manual') or left
/// null for Phase 5c (GSP) to populate. VendorPurchaseId is the URL parent —
/// enforced by controller route, so it isn't on the request body.
public record RecordEwayBillRequest(
    /// 12-digit portal-issued number. Required.
    string EwayNumber,
    /// Portal generation timestamp. Null → SP defaults to now().
    DateTimeOffset? GenerationDate,
    /// Vendor's invoice number the e-way covers. Usually same as
    /// vendor_purchases.invoice_number but kept separate — the portal
    /// records exactly what was submitted.
    string? DocumentNumber,
    DateOnly? DocumentDate,
    DateTimeOffset? ValidUntil,
    /// Vendor GSTIN (issuer).
    string? FromGstin,
    string? FromStateCode,
    /// Our GSTIN (recipient).
    string? ToGstin,
    string? ToStateCode,
    /// "Road" | "Rail" | "Air" | "Ship".
    string? TransportMode,
    int? DistanceKm,
    string? TransporterName,
    string? VehicleNumber,
    decimal? TaxableAmount,
    /// Intra-state pair. Enforce XOR with IGST at validator level; SP has
    /// chk_eway_bills_tax_exclusive as the final safety.
    decimal? CgstAmount,
    decimal? SgstAmount,
    /// Inter-state single tax. XOR with CGST/SGST.
    decimal? IgstAmount,
    decimal? TotalAmount,
    /// Optional URL to the portal PDF blob.
    string? AttachmentUrl,
    string? Notes
);
