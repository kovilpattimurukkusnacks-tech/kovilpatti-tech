using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class EwayBillRepository(IDbConnectionFactory factory) : IEwayBillRepository
{
    public async Task<decimal> GetInboundThresholdAsync(CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_eway_threshold_get(@p_direction)";
        return await conn.ExecuteScalarAsync<decimal>(new CommandDefinition(
            sql, new { p_direction = "Inbound" }, cancellationToken: ct));
    }

    public async Task<Guid> RecordInboundAsync(
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
        CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = @"
            SELECT fn_eway_bill_record(
                @p_purchase_id, @p_eway_number, @p_generation_date,
                @p_document_number, @p_document_date, @p_valid_until,
                @p_from_gstin, @p_from_state_code,
                @p_to_gstin,   @p_to_state_code,
                @p_transport_mode, @p_distance_km,
                @p_transporter_name, @p_vehicle_number,
                @p_taxable_amount, @p_cgst_amount, @p_sgst_amount,
                @p_igst_amount, @p_total_amount,
                @p_attachment_url, @p_notes, @p_user_id)";

        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(sql, new
        {
            p_purchase_id      = purchaseId,
            p_eway_number      = ewayNumber,
            p_generation_date  = generationDate,
            p_document_number  = documentNumber,
            p_document_date    = documentDate,
            p_valid_until      = validUntil,
            p_from_gstin       = fromGstin,
            p_from_state_code  = fromStateCode,
            p_to_gstin         = toGstin,
            p_to_state_code    = toStateCode,
            p_transport_mode   = transportMode,
            p_distance_km      = distanceKm,
            p_transporter_name = transporterName,
            p_vehicle_number   = vehicleNumber,
            p_taxable_amount   = taxableAmount,
            p_cgst_amount      = cgstAmount,
            p_sgst_amount      = sgstAmount,
            p_igst_amount      = igstAmount,
            p_total_amount     = totalAmount,
            p_attachment_url   = attachmentUrl,
            p_notes            = notes,
            p_user_id          = userId
        }, cancellationToken: ct));
    }

    public async Task<EwayBill?> GetAsync(Guid id, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_eway_bill_get(@p_id)";
        return await conn.QuerySingleOrDefaultAsync<EwayBill>(
            new CommandDefinition(sql, new { p_id = id }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<EwayBill>> ListForPurchaseAsync(Guid purchaseId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_eway_bill_list_for_purchase(@p_purchase_id)";
        var rows = await conn.QueryAsync<EwayBill>(
            new CommandDefinition(sql, new { p_purchase_id = purchaseId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<bool> CancelAsync(Guid id, string? reason, Guid userId, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_eway_bill_cancel(@p_id, @p_reason, @p_user_id)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(sql, new
        {
            p_id      = id,
            p_reason  = reason,
            p_user_id = userId
        }, cancellationToken: ct));
    }
}
