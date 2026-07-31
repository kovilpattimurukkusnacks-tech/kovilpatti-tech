using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs.EwayBills;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class EwayBillService(
    IEwayBillRepository eway,
    IVendorPurchaseRepository purchases,
    ICurrentUser currentUser,
    IValidator<RecordEwayBillRequest> recordValidator
) : IEwayBillService
{
    public Task<decimal> GetInboundThresholdAsync(CancellationToken ct = default)
        => eway.GetInboundThresholdAsync(ct);

    public async Task<IReadOnlyList<EwayBillDto>> ListForPurchaseAsync(Guid purchaseId, CancellationToken ct = default)
    {
        if (!await purchases.ExistsAsync(purchaseId, ct))
            throw new NotFoundException($"Vendor purchase '{purchaseId}' not found.");

        var rows = await eway.ListForPurchaseAsync(purchaseId, ct);
        return rows.Select(Map).ToList();
    }

    public async Task<EwayBillDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await eway.GetAsync(id, ct)
            ?? throw new NotFoundException($"E-way bill '{id}' not found.");
        return Map(row);
    }

    public async Task<EwayBillDto> RecordInboundAsync(
        Guid purchaseId, RecordEwayBillRequest request, CancellationToken ct = default)
    {
        var validation = await recordValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        // Parent must exist, be non-deleted, and be interstate — the receive
        // gate only fires for interstate purchases, so recording an inbound
        // e-way against a domestic one is almost certainly a mistake.
        var parent = await purchases.GetAsync(purchaseId, ct)
            ?? throw new NotFoundException($"Vendor purchase '{purchaseId}' not found.");

        if (!parent.Is_Interstate)
        {
            throw new ValidationException(new[] {
                new ValidationFailure("purchaseId",
                    "This purchase is intrastate — an e-way bill is not required and cannot be attached.")
            });
        }

        var id = await eway.RecordInboundAsync(
            purchaseId,
            request.EwayNumber.Trim(),
            request.GenerationDate,
            string.IsNullOrWhiteSpace(request.DocumentNumber) ? null : request.DocumentNumber.Trim(),
            request.DocumentDate,
            request.ValidUntil,
            string.IsNullOrWhiteSpace(request.FromGstin) ? null : request.FromGstin.Trim(),
            string.IsNullOrWhiteSpace(request.FromStateCode) ? null : request.FromStateCode.Trim(),
            string.IsNullOrWhiteSpace(request.ToGstin) ? null : request.ToGstin.Trim(),
            string.IsNullOrWhiteSpace(request.ToStateCode) ? null : request.ToStateCode.Trim(),
            string.IsNullOrWhiteSpace(request.TransportMode) ? null : request.TransportMode,
            request.DistanceKm,
            string.IsNullOrWhiteSpace(request.TransporterName) ? null : request.TransporterName.Trim(),
            string.IsNullOrWhiteSpace(request.VehicleNumber) ? null : request.VehicleNumber.Trim(),
            request.TaxableAmount,
            request.CgstAmount, request.SgstAmount, request.IgstAmount,
            request.TotalAmount,
            string.IsNullOrWhiteSpace(request.AttachmentUrl) ? null : request.AttachmentUrl.Trim(),
            string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
            userId, ct);

        return await GetAsync(id, ct);
    }

    public async Task CancelAsync(Guid id, string? reason, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await eway.GetAsync(id, ct)
            ?? throw new NotFoundException($"E-way bill '{id}' not found.");

        var ok = await eway.CancelAsync(id, reason, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot cancel — e-way bill is in '{existing.Status}' state.")
        });
    }

    // ── Mapping ───────────────────────────────────────────────────────

    private static EwayBillDto Map(EwayBill r) => new(
        Id:               r.Id,
        EwayNumber:       r.Eway_Number,
        GenerationDate:   r.Generation_Date,
        Direction:        r.Direction,
        VendorPurchaseId: r.Vendor_Purchase_Id,
        StockRequestId:   r.Stock_Request_Id,
        BillId:           r.Bill_Id,
        DocumentNumber:   r.Document_Number,
        DocumentDate:     r.Document_Date,
        FromGstin:        r.From_Gstin,
        FromStateCode:    r.From_State_Code,
        ToGstin:          r.To_Gstin,
        ToStateCode:      r.To_State_Code,
        TransportMode:    r.Transport_Mode,
        DistanceKm:       r.Distance_Km,
        TransporterName:  r.Transporter_Name,
        VehicleNumber:    r.Vehicle_Number,
        TaxableAmount:    r.Taxable_Amount,
        CgstAmount:       r.Cgst_Amount,
        SgstAmount:       r.Sgst_Amount,
        IgstAmount:       r.Igst_Amount,
        TotalAmount:      r.Total_Amount,
        ValidFrom:        r.Valid_From,
        ValidUntil:       r.Valid_Until,
        Status:           r.Status,
        GeneratedVia:     r.Generated_Via,
        AttachmentUrl:    r.Attachment_Url,
        Notes:            r.Notes,
        CreatedAt:        r.Created_At
    );
}
