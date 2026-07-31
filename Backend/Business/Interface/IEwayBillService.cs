using KovilpattiSnacks.Business.DTOs.EwayBills;

namespace KovilpattiSnacks.Business.Interface;

/// Phase 5b — Inbound-only e-way bill operations. Outbound is Phase 4's job.
public interface IEwayBillService
{
    /// Inbound threshold in ₹. 0 = gate disabled. Cheap read — surfaces on
    /// the AdminPurchaseNew screen so the FE can decide whether to render
    /// the e-way section.
    Task<decimal> GetInboundThresholdAsync(CancellationToken ct = default);

    Task<IReadOnlyList<EwayBillDto>> ListForPurchaseAsync(Guid purchaseId, CancellationToken ct = default);
    Task<EwayBillDto> GetAsync(Guid id, CancellationToken ct = default);

    Task<EwayBillDto> RecordInboundAsync(
        Guid purchaseId, RecordEwayBillRequest request, CancellationToken ct = default);

    Task CancelAsync(Guid id, string? reason, CancellationToken ct = default);
}
