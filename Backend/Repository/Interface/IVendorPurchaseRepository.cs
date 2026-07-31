using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IVendorPurchaseRepository
{
    Task<(List<VendorPurchase> Rows, long Total)> ListPagedAsync(
        int page, int pageSize,
        Guid? vendorId = null, Guid? godownId = null, string? status = null,
        bool? isInterstate = null, DateOnly? fromDate = null, DateOnly? toDate = null,
        string? search = null,
        CancellationToken ct = default);

    Task<VendorPurchase?> GetAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsAsync(Guid id, CancellationToken ct = default);
    Task<string> NextCodeAsync(CancellationToken ct = default);

    Task<Guid> CreateAsync(
        string code, Guid vendorId, Guid godownId,
        string invoiceNumber, DateOnly invoiceDate, decimal invoiceAmount,
        string? notes, string itemsJson, Guid userId,
        CancellationToken ct = default);

    Task<bool> UpdateAsync(
        Guid id, string invoiceNumber, DateOnly invoiceDate, decimal invoiceAmount,
        string? notes, string itemsJson, Guid userId,
        CancellationToken ct = default);

    Task<bool> ReceiveAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<bool> CancelAsync(Guid id, Guid userId, CancellationToken ct = default);
}
