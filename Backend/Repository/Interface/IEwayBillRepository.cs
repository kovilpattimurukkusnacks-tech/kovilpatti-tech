using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

/// Phase 5b — thin CRUD over eway_bills, Inbound only. Outbound writes
/// stay unimplemented until Phase 4 wires them.
public interface IEwayBillRepository
{
    /// Returns the inbound threshold in ₹. 0 = gate disabled.
    Task<decimal> GetInboundThresholdAsync(CancellationToken ct = default);

    /// Insert (or dedup) an inbound e-way bill against a vendor purchase.
    /// Idempotent on (purchase_id, eway_number).
    Task<Guid> RecordInboundAsync(
        Guid purchaseId,
        string ewayNumber,
        DateTimeOffset? generationDate,
        string? documentNumber,
        DateOnly? documentDate,
        DateTimeOffset? validUntil,
        string? fromGstin, string? fromStateCode,
        string? toGstin,   string? toStateCode,
        string? transportMode, int? distanceKm,
        string? transporterName, string? vehicleNumber,
        decimal? taxableAmount,
        decimal? cgstAmount, decimal? sgstAmount, decimal? igstAmount,
        decimal? totalAmount,
        string? attachmentUrl, string? notes,
        Guid userId,
        CancellationToken ct = default);

    Task<EwayBill?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<EwayBill>> ListForPurchaseAsync(Guid purchaseId, CancellationToken ct = default);

    Task<bool> CancelAsync(Guid id, string? reason, Guid userId, CancellationToken ct = default);
}
