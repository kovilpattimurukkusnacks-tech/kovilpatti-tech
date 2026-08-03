using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class BillRepository(IDbConnectionFactory factory) : IBillRepository
{
    public async Task<List<BillingProduct>> BillingProductsAsync(
        Guid shopId, string? search, int limit, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_billing_products(@p_shop_id, @p_search, @p_limit)";
        var rows = await conn.QueryAsync<BillingProduct>(new CommandDefinition(
            sql, new { p_shop_id = shopId, p_search = search, p_limit = limit }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillCreated> CreateAsync(
        Guid shopId, Guid userId, Guid? customerId, string paymentsJson, string itemsJson, string? notes,
        string? discountKind, decimal? discountValue,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_create(@p_shop_id, @p_user_id, @p_customer_id, @p_payments::jsonb, @p_items::jsonb, @p_notes, @p_discount_kind, @p_discount_value)";
        return await conn.QuerySingleAsync<BillCreated>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId,
            p_user_id = userId,
            p_customer_id = customerId,
            p_payments = paymentsJson,
            p_items = itemsJson,
            p_notes = notes,
            p_discount_kind = discountKind,
            p_discount_value = discountValue,
        }, cancellationToken: ct));
    }

    public async Task<List<BillPaymentRow>> GetPaymentsAsync(Guid billId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_get_payments(@p_bill_id)";
        var rows = await conn.QueryAsync<BillPaymentRow>(new CommandDefinition(
            sql, new { p_bill_id = billId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task CancelAsync(
        Guid billId, Guid shopId, Guid userId, string reasonType, string? reasonNote,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT fn_bill_cancel(@p_bill_id, @p_shop_id, @p_user_id, @p_reason_type, @p_reason_note)";
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            p_bill_id = billId, p_shop_id = shopId, p_user_id = userId,
            p_reason_type = reasonType, p_reason_note = reasonNote,
        }, cancellationToken: ct));
    }

    public async Task<List<BillListRow>> ListAsync(
        Guid shopId, string? search, string? status, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_list(@p_shop_id, @p_search, @p_status, @p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<BillListRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search, p_status = status,
            p_from = from, p_to = to, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillHeader?> GetAsync(Guid billId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_get(@p_bill_id, @p_shop_id)";
        return await conn.QuerySingleOrDefaultAsync<BillHeader>(new CommandDefinition(
            sql, new { p_bill_id = billId, p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<List<BillItemRow>> GetItemsAsync(Guid billId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_get_items(@p_bill_id)";
        var rows = await conn.QueryAsync<BillItemRow>(new CommandDefinition(
            sql, new { p_bill_id = billId }, cancellationToken: ct));
        return rows.ToList();
    }

    // ───────── Bill returns (feature #1) ─────────

    public async Task<List<BillReturnableItem>> ReturnableItemsAsync(
        Guid billId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_returnable_items(@p_bill_id, @p_shop_id)";
        var rows = await conn.QueryAsync<BillReturnableItem>(new CommandDefinition(
            sql, new { p_bill_id = billId, p_shop_id = shopId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillReturnCreated> CreateReturnAsync(
        Guid billId, Guid shopId, Guid userId, string refundMode,
        string reasonType, string? reasonNote, string itemsJson, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_return_create(@p_bill_id, @p_shop_id, @p_user_id, " +
            "@p_refund_mode, @p_reason_type, @p_reason_note, @p_items::jsonb)";
        return await conn.QuerySingleAsync<BillReturnCreated>(new CommandDefinition(sql, new
        {
            p_bill_id = billId,
            p_shop_id = shopId,
            p_user_id = userId,
            p_refund_mode = refundMode,
            p_reason_type = reasonType,
            p_reason_note = reasonNote,
            p_items = itemsJson,
        }, cancellationToken: ct));
    }

    public async Task<List<BillReturnListRow>> ListReturnsAsync(
        Guid shopId, string? search, DateOnly? from, DateOnly? to,
        int page, int pageSize, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT * FROM fn_bill_return_list(@p_shop_id, @p_search, @p_from, @p_to, @p_page, @p_page_size)";
        var rows = await conn.QueryAsync<BillReturnListRow>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_search = search,
            p_from = from, p_to = to, p_page = page, p_page_size = pageSize,
        }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<BillReturnHeader?> GetReturnAsync(
        Guid returnId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_return_get(@p_return_id, @p_shop_id)";
        return await conn.QuerySingleOrDefaultAsync<BillReturnHeader>(new CommandDefinition(
            sql, new { p_return_id = returnId, p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<List<BillReturnItemRow>> GetReturnItemsAsync(
        Guid returnId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_return_get_items(@p_return_id)";
        var rows = await conn.QueryAsync<BillReturnItemRow>(new CommandDefinition(
            sql, new { p_return_id = returnId }, cancellationToken: ct));
        return rows.ToList();
    }

    // ───────── Held (draft) bills (feature #3) ─────────

    public async Task<Guid> HoldCreateAsync(
        Guid shopId, Guid userId, Guid? customerId, string? label, string? note, string itemsJson,
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql =
            "SELECT fn_bill_hold_create(@p_shop_id, @p_user_id, @p_customer_id, @p_label, @p_note, @p_items::jsonb)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_shop_id = shopId, p_user_id = userId, p_customer_id = customerId,
            p_label = label, p_note = note, p_items = itemsJson,
        }, cancellationToken: ct));
    }

    public async Task<List<HeldBillListRow>> HoldListAsync(Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_hold_list(@p_shop_id)";
        var rows = await conn.QueryAsync<HeldBillListRow>(new CommandDefinition(
            sql, new { p_shop_id = shopId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<HeldBillHeader?> HoldGetAsync(Guid heldBillId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_hold_get(@p_held_bill_id, @p_shop_id)";
        return await conn.QuerySingleOrDefaultAsync<HeldBillHeader>(new CommandDefinition(
            sql, new { p_held_bill_id = heldBillId, p_shop_id = shopId }, cancellationToken: ct));
    }

    public async Task<List<HeldBillItemRow>> HoldGetItemsAsync(
        Guid heldBillId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_bill_hold_get_items(@p_held_bill_id, @p_shop_id)";
        var rows = await conn.QueryAsync<HeldBillItemRow>(new CommandDefinition(
            sql, new { p_held_bill_id = heldBillId, p_shop_id = shopId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task HoldDeleteAsync(Guid heldBillId, Guid shopId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_bill_hold_delete(@p_held_bill_id, @p_shop_id)";
        await conn.ExecuteAsync(new CommandDefinition(
            sql, new { p_held_bill_id = heldBillId, p_shop_id = shopId }, cancellationToken: ct));
    }
}
