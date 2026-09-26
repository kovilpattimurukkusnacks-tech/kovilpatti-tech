using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Repository.Interface;

public interface IBillRepository
{
    Task<List<BillingProduct>> BillingProductsAsync(
        Guid shopId, string? search, int limit, CancellationToken ct = default);

    /// <param name="paymentsJson">jsonb array of {"mode": "Cash"|"UPI"|"Credit", "amount": numeric}</param>
    /// <param name="itemsJson">jsonb array of {"productId": uuid, "qty": int}</param>
    Task<BillCreated> CreateAsync(
        Guid shopId, Guid userId, Guid? customerId, string paymentsJson, string itemsJson, string? notes,
        string? discountKind, decimal? discountValue, decimal? cashTendered,
        CancellationToken ct = default);

    Task<List<BillPaymentRow>> GetPaymentsAsync(Guid billId, CancellationToken ct = default);

    /// <param name="isAdmin">true = admin override (any cashier's bill, closed days).</param>
    Task CancelAsync(
        Guid billId, Guid shopId, Guid userId, string reasonType, string? reasonNote, bool isAdmin,
        CancellationToken ct = default);

    Task<List<BillListRow>> ListAsync(
        Guid shopId, string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<BillHeader?> GetAsync(Guid billId, Guid shopId, CancellationToken ct = default);

    Task<List<BillItemRow>> GetItemsAsync(Guid billId, CancellationToken ct = default);

    // ───────── Bill returns (feature #1) ─────────

    Task<List<BillReturnableItem>> ReturnableItemsAsync(
        Guid billId, Guid shopId, CancellationToken ct = default);

    /// One row per tender mode on the bill — paid / refunded / remaining.
    Task<List<BillRefundOption>> RefundOptionsAsync(
        Guid billId, Guid shopId, CancellationToken ct = default);

    /// <param name="itemsJson">jsonb array of {"productId": uuid, "qty": int}</param>
    /// <param name="isAdmin">true = admin override (past the return window).</param>
    Task<BillReturnCreated> CreateReturnAsync(
        Guid billId, Guid shopId, Guid userId, string refundMode,
        string reasonType, string? reasonNote, string itemsJson, bool isAdmin, CancellationToken ct = default);

    Task<List<BillReturnListRow>> ListReturnsAsync(
        Guid shopId, string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default);

    Task<BillReturnHeader?> GetReturnAsync(Guid returnId, Guid shopId, CancellationToken ct = default);

    Task<List<BillReturnItemRow>> GetReturnItemsAsync(Guid returnId, CancellationToken ct = default);

    // ───────── Held (draft) bills (feature #3) ─────────

    Task<Guid> HoldCreateAsync(
        Guid shopId, Guid userId, Guid? customerId, string? label, string? note, string itemsJson,
        CancellationToken ct = default);

    Task<List<HeldBillListRow>> HoldListAsync(Guid shopId, CancellationToken ct = default);

    Task<HeldBillHeader?> HoldGetAsync(Guid heldBillId, Guid shopId, CancellationToken ct = default);

    Task<List<HeldBillItemRow>> HoldGetItemsAsync(Guid heldBillId, Guid shopId, CancellationToken ct = default);

    Task HoldDeleteAsync(Guid heldBillId, Guid shopId, CancellationToken ct = default);
}
