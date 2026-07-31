using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.VendorPurchases;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

// Phase 5a — vendor master + purchase records CRUD, no e-way bill wiring.
// eway_bills doesn't exist in this codebase yet and the threshold value is
// unconfirmed (see DB/planned/phase5_reconciliation_notes.md Decision 5) —
// Phase 5b adds the "block Mark Received without an e-way bill" gate once
// both land. Today ReceiveAsync is a plain Ordered→Received transition.
public class VendorPurchaseService(
    IVendorPurchaseRepository purchases,
    IVendorRepository vendors,
    IInventoryRepository godowns,
    IProductRepository products,
    ICurrentUser currentUser,
    IValidator<CreateVendorPurchaseRequest> createValidator,
    IValidator<UpdateVendorPurchaseRequest> updateValidator
) : IVendorPurchaseService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    public async Task<PagedResult<VendorPurchaseDto>> ListAsync(
        Guid? vendorId, Guid? godownId, string? status, bool? isInterstate,
        DateOnly? fromDate, DateOnly? toDate, string? search,
        int page, int pageSize,
        CancellationToken ct = default)
    {
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 10 : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await purchases.ListPagedAsync(
            safePage, safePageSize, vendorId, godownId, status, isInterstate, fromDate, toDate, search, ct);

        return new PagedResult<VendorPurchaseDto>(rows.Select(MapHeaderToDto).ToList(), total, safePage, safePageSize);
    }

    public async Task<VendorPurchaseDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await purchases.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor purchase '{id}' not found.");
        return MapWithItems(row);
    }

    public async Task<VendorPurchaseDto> CreateAsync(CreateVendorPurchaseRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        if (!await vendors.ExistsAsync(request.VendorId, ct))
            throw new NotFoundException($"Vendor '{request.VendorId}' not found.");

        if (!await godowns.ExistsAsync(request.GodownId, ct))
            throw new NotFoundException($"Godown '{request.GodownId}' not found.");

        await EnsureProductsExistAsync(request.Items.Select(i => i.ProductId), ct);

        var itemsJson = BuildItemsJson(request.Items);
        var code = await purchases.NextCodeAsync(ct);

        var newId = await purchases.CreateAsync(
            code, request.VendorId, request.GodownId,
            request.InvoiceNumber.Trim(), request.InvoiceDate, request.InvoiceAmount,
            string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
            itemsJson, userId, ct);

        return await GetAsync(newId, ct);
    }

    public async Task<VendorPurchaseDto> UpdateAsync(Guid id, UpdateVendorPurchaseRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await purchases.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor purchase '{id}' not found.");

        await EnsureProductsExistAsync(request.Items.Select(i => i.ProductId), ct);

        var itemsJson = BuildItemsJson(request.Items);

        var ok = await purchases.UpdateAsync(
            id, request.InvoiceNumber.Trim(), request.InvoiceDate, request.InvoiceAmount,
            string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
            itemsJson, userId, ct);

        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot edit — purchase is in '{existing.Status}' state.")
        });

        return await GetAsync(id, ct);
    }

    public async Task<VendorPurchaseDto> ReceiveAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await purchases.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor purchase '{id}' not found.");

        var ok = await purchases.ReceiveAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot mark received — purchase is in '{existing.Status}' state.")
        });

        return await GetAsync(id, ct);
    }

    public async Task CancelAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await purchases.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor purchase '{id}' not found.");

        var ok = await purchases.CancelAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot cancel — purchase is in '{existing.Status}' state.")
        });
    }

    // ───────── Helpers ─────────

    private async Task EnsureProductsExistAsync(IEnumerable<Guid> productIds, CancellationToken ct)
    {
        var ids = productIds.ToHashSet();
        var all = await products.ListAsync(null, null, includeInactive: true, ct: ct);
        var found = all.Select(p => p.Id).ToHashSet();

        var missing = ids.Where(id => !found.Contains(id)).ToList();
        if (missing.Count > 0)
        {
            var failures = missing.Select(id => new ValidationFailure(
                "items", $"Product '{id}' not found.")).ToList();
            throw new ValidationException(failures);
        }
    }

    private static string BuildItemsJson(IReadOnlyList<CreateVendorPurchaseItem> items)
        => JsonSerializer.Serialize(items.Select(i => new
        {
            product_id = i.ProductId,
            qty        = i.Qty,
            unit_cost  = i.UnitCost,
        }), JsonOpts);

    private record RawItem(
        Guid Id, Guid ProductId, string ProductCode, string ProductName,
        decimal Qty, decimal UnitCost, decimal LineTotal,
        decimal? WeightValue, string? WeightUnit);

    private static IReadOnlyList<VendorPurchaseItemDto> ParseItems(string? itemsJson)
    {
        if (string.IsNullOrWhiteSpace(itemsJson)) return Array.Empty<VendorPurchaseItemDto>();

        var raws = JsonSerializer.Deserialize<List<RawItem>>(itemsJson, JsonOpts)
            ?? new List<RawItem>();

        return raws.Select(r => new VendorPurchaseItemDto(
            r.Id, r.ProductId, r.ProductCode, r.ProductName,
            r.Qty, r.UnitCost, r.LineTotal, r.WeightValue, r.WeightUnit)).ToList();
    }

    private static VendorPurchaseDto MapHeaderToDto(VendorPurchase p) => new(
        Id:             p.Id,
        Code:           p.Code,
        VendorId:       p.Vendor_Id,
        VendorCode:     p.Vendor_Code,
        VendorName:     p.Vendor_Name,
        GodownId:       p.Godown_Id,
        GodownCode:     p.Godown_Code,
        GodownName:     p.Godown_Name,
        IsInterstate:   p.Is_Interstate,
        InvoiceNumber:  p.Invoice_Number,
        InvoiceDate:    p.Invoice_Date,
        InvoiceAmount:  p.Invoice_Amount,
        Status:         p.Status,
        TotalItems:     p.Total_Items,
        TotalQty:       p.Total_Qty,
        TotalAmount:    p.Total_Amount,
        Notes:          p.Notes,
        ReceivedAt:     p.Received_At,
        ReceivedByName: p.Received_By_Name,
        CreatedAt:      p.Created_At,
        Items:          null
    );

    private static VendorPurchaseDto MapWithItems(VendorPurchase p)
        => MapHeaderToDto(p) with { Items = ParseItems(p.Items) };
}
