using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.StockRequests;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class StockRequestService(
    IStockRequestRepository requests,
    IShopRepository shops,
    IProductRepository products,
    IAppSettingRepository settings,
    ICurrentUser currentUser,
    IValidator<CreateStockRequestRequest> createValidator,
    IValidator<UpdateStockRequestRequest> updateValidator,
    IValidator<RejectRequest> rejectValidator,
    IValidator<DispatchRequest> dispatchValidator
) : IStockRequestService
{
    // IST is a fixed offset (UTC+5:30) — India doesn't observe DST.
    // Using a fixed offset avoids TimeZoneInfo cross-platform headaches.
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    // ───────── Read ─────────

    public async Task<PagedResult<StockRequestDto>> ListAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize, CancellationToken ct = default)
    {
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 10 : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await requests.ListPagedAsync(shopId, inventoryId, status, search, safePage, safePageSize, ct);
        var items = rows.Select(MapHeaderToDto).ToList();
        return new PagedResult<StockRequestDto>(items, total, safePage, safePageSize);
    }

    public async Task<StockRequestDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Role-based access: shop users only see their own; inventory users only their inventory's; admin sees all.
        var role = currentUser.Role;
        if (string.Equals(role, "ShopUser", StringComparison.OrdinalIgnoreCase)
            && currentUser.ShopId != row.Shop_Id)
            throw new ForbiddenException("This request does not belong to your shop.");
        if (string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            && currentUser.InventoryId != row.Inventory_Id)
            throw new ForbiddenException("This request does not belong to your inventory.");

        return MapWithItems(row);
    }

    public async Task<IReadOnlyList<CumulativePendingLineDto>> GetPendingCumulativeAsync(
        Guid? inventoryId, CancellationToken ct = default)
    {
        // Role gates:
        //   • ShopUser  → never (they don't pack batches).
        //   • Inventory → forced to their own inventory; ignore any explicit
        //                 inventoryId param to prevent cross-godown peeking.
        //   • Admin     → may pass any inventoryId or NULL for tenant-wide total.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "ShopUser", StringComparison.OrdinalIgnoreCase))
            throw new ForbiddenException("Shop users cannot view the cumulative report.");

        Guid? scope = string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            ? currentUser.InventoryId
            : inventoryId;

        var rows = await requests.GetPendingCumulativeAsync(scope, ct);
        return rows.Select(r => new CumulativePendingLineDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.Category_Name, r.Type,
            r.Weight_Value, r.Weight_Unit, r.Total_Qty, r.Request_Count)).ToList();
    }

    // ───────── Write — Create ─────────

    public async Task<StockRequestDto> CreateAsync(CreateStockRequestRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var shopId = currentUser.ShopId
            ?? throw new ForbiddenException("Only shop users can create stock requests.");

        var shop = await shops.GetAsync(shopId, ct)
            ?? throw new NotFoundException("Your shop record was not found.");

        // Resolve product MRPs (snapshot at submit time) and validate they exist.
        var productMap = await ResolveAndValidateProducts(request.Items.Select(i => i.ProductId).ToHashSet(), ct);

        // Compute editable_until from the configured cutoff.
        var cutoffStr = (await settings.GetAsync("request_lock_cutoff", ct))?.Value ?? "09:00";
        var editableUntil = ComputeEditableUntil(cutoffStr);

        // Build items JSON for the SP (snake_case keys for jsonb_extract).
        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            product_id    = i.ProductId,
            requested_qty = i.RequestedQty,
            unit_price    = productMap[i.ProductId].Mrp,
        }), JsonOpts);

        var code = await requests.NextCodeAsync(ct);
        var newId = await requests.CreateAsync(
            code, shop.Id, shop.InventoryId, editableUntil, request.Notes,
            itemsJson, userId, ct);

        return await GetAsync(newId, ct);
    }

    // ───────── Write — Update ─────────

    public async Task<StockRequestDto> UpdateAsync(Guid id, UpdateStockRequestRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Shop user can only edit own Pending requests within the time window.
        // Admin can edit any Pending or Approved request, ignoring time window.
        var role = currentUser.Role ?? "";
        var isAdmin = string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase);

        if (string.Equals(role, "ShopUser", StringComparison.OrdinalIgnoreCase))
        {
            if (existing.Shop_Id != currentUser.ShopId)
                throw new ForbiddenException("This request does not belong to your shop.");

            var nowIst = DateTimeOffset.UtcNow.ToOffset(IstOffset);
            if (nowIst > existing.Editable_Until)
                throw new ValidationException(new[]
                {
                    new ValidationFailure("editable_until",
                        "Edit window has closed. This request is now locked. Only an admin can modify it.")
                });
        }
        else if (!isAdmin)
        {
            throw new ForbiddenException("Only the shop's user or an admin can edit a request.");
        }

        // Status rule: shop only Pending; admin Pending or Approved.
        var status = existing.Status ?? "";
        var allowedForRole = isAdmin
            ? (string.Equals(status, "Pending",  StringComparison.OrdinalIgnoreCase)
               || string.Equals(status, "Approved", StringComparison.OrdinalIgnoreCase))
            : string.Equals(status, "Pending", StringComparison.OrdinalIgnoreCase);

        if (!allowedForRole)
            throw new ValidationException(new[] {
                new ValidationFailure("status", $"Cannot edit a request in '{existing.Status}' state.")
            });

        var productMap = await ResolveAndValidateProducts(request.Items.Select(i => i.ProductId).ToHashSet(), ct);

        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            product_id    = i.ProductId,
            requested_qty = i.RequestedQty,
            unit_price    = productMap[i.ProductId].Mrp,
        }), JsonOpts);

        var ok = await requests.UpdateAsync(id, request.Notes, itemsJson, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", "Request cannot be edited in its current state.")
        });

        return await GetAsync(id, ct);
    }

    // ───────── Status transitions ─────────

    public async Task<StockRequestDto> ApproveAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Inventory user may only approve requests routed to their own godown.
        // Admin can approve any. Approving locks the request — once status
        // moves out of Pending the shop can no longer edit.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            && currentUser.InventoryId != existing.Inventory_Id)
            throw new ForbiddenException("This request is for a different inventory.");

        var ok = await requests.ApproveAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot approve — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> RejectAsync(Guid id, RejectRequest request, CancellationToken ct = default)
    {
        var validation = await rejectValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Same scope rule as Approve — inventory only rejects their own.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            && currentUser.InventoryId != existing.Inventory_Id)
            throw new ForbiddenException("This request is for a different inventory.");

        var ok = await requests.RejectAsync(id, userId, request.Reason, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot reject — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> RevokeAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Inventory user may only revoke their own godown's action; admin any.
        // SP additionally guards status IN ('Approved','Rejected') so once the
        // request has been dispatched there's no taking it back.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            && currentUser.InventoryId != existing.Inventory_Id)
            throw new ForbiddenException("This request is for a different inventory.");

        var ok = await requests.RevokeAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot revoke — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> DispatchAsync(Guid id, DispatchRequest request, CancellationToken ct = default)
    {
        var validation = await dispatchValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Inventory user can only dispatch their own godown's requests.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "Inventory", StringComparison.OrdinalIgnoreCase)
            && currentUser.InventoryId != existing.Inventory_Id)
            throw new ForbiddenException("This request is for a different inventory.");

        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            id              = i.Id,
            dispatched_qty  = i.DispatchedQty,
        }), JsonOpts);

        var ok = await requests.DispatchAsync(id, userId, itemsJson, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot dispatch — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> ReceiveAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Shop user can only mark their own request received.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "ShopUser", StringComparison.OrdinalIgnoreCase)
            && currentUser.ShopId != existing.Shop_Id)
            throw new ForbiddenException("This request does not belong to your shop.");

        var ok = await requests.ReceiveAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot mark received — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> CancelAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Shop user: own only + within edit window. Admin: any.
        var role = currentUser.Role ?? "";
        if (string.Equals(role, "ShopUser", StringComparison.OrdinalIgnoreCase))
        {
            if (existing.Shop_Id != currentUser.ShopId)
                throw new ForbiddenException("This request does not belong to your shop.");

            var nowIst = DateTimeOffset.UtcNow.ToOffset(IstOffset);
            if (nowIst > existing.Editable_Until)
                throw new ValidationException(new[] {
                    new ValidationFailure("editable_until",
                        "Edit window has closed. Ask an admin to cancel this request.")
                });
        }
        else if (!string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
        {
            throw new ForbiddenException("Only the shop's user or an admin can cancel a request.");
        }

        var ok = await requests.CancelAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot cancel — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    // ───────── Helpers ─────────

    private async Task<Dictionary<Guid, Product>> ResolveAndValidateProducts(HashSet<Guid> ids, CancellationToken ct)
    {
        // Phase 1 product repo's ListAsync returns all non-deleted products. Filter to requested IDs.
        var all = await products.ListAsync(null, null, ct);
        var map = all.Where(p => ids.Contains(p.Id)).ToDictionary(p => p.Id);

        var missing = ids.Where(id => !map.ContainsKey(id)).ToList();
        if (missing.Count > 0)
        {
            var failures = missing.Select(id => new ValidationFailure(
                "items", $"Product '{id}' not found or inactive.")).ToList();
            throw new ValidationException(failures);
        }

        return map;
    }

    /// Compute the next cutoff timestamp from the configured cutoff time (HH:MM, IST).
    /// If NOW (IST) is before today's cutoff → today's cutoff. Otherwise → tomorrow's.
    /// Returned as UTC-offset (0) because Npgsql rejects non-UTC DateTimeOffset
    /// values when writing to `timestamptz`. The wall-clock IST instant is preserved.
    private static DateTimeOffset ComputeEditableUntil(string cutoffStr)
    {
        var parts = cutoffStr.Split(':');
        if (parts.Length != 2 ||
            !int.TryParse(parts[0], out var hour) ||
            !int.TryParse(parts[1], out var minute) ||
            hour < 0 || hour > 23 || minute < 0 || minute > 59)
        {
            // Defensive: bad setting value → default to 9 AM IST.
            hour = 9;
            minute = 0;
        }

        var nowIst = DateTimeOffset.UtcNow.ToOffset(IstOffset);
        var todayCutoff = new DateTimeOffset(
            nowIst.Year, nowIst.Month, nowIst.Day,
            hour, minute, 0, IstOffset);

        var cutoff = nowIst <= todayCutoff ? todayCutoff : todayCutoff.AddDays(1);
        return cutoff.ToUniversalTime();
    }

    // ───────── Mappers ─────────

    private static StockRequestDto MapHeaderToDto(StockRequest r)
        => new(
            r.Id, r.Code,
            r.Shop_Id, r.Shop_Code, r.Shop_Name,
            r.Inventory_Id, r.Inventory_Code, r.Inventory_Name,
            r.Submitted_By_Name, r.Approved_By_Name, r.Dispatched_By_Name, r.Received_By_Name,
            r.Status, r.Total_Items, r.Total_Qty, r.Total_Dispatched_Qty, r.Total_Amount, r.Total_Dispatched_Amount,
            r.Notes, r.Rejection_Reason,
            r.Editable_Until, r.Submitted_At,
            r.Approved_At, r.Approved_By,
            r.Dispatched_At, r.Dispatched_By,
            r.Received_At, r.Cancelled_At, r.Cancelled_By,
            Items: null);

    private static StockRequestDto MapWithItems(StockRequest r)
    {
        var items = string.IsNullOrWhiteSpace(r.Items)
            ? new List<StockRequestItemDto>()
            : (JsonSerializer.Deserialize<List<RawItem>>(r.Items, ReadJsonOpts) ?? new List<RawItem>())
              .Select(i => new StockRequestItemDto(
                  i.id, i.product_id, i.product_code, i.product_name,
                  i.weight_value, i.weight_unit,
                  i.requested_qty, i.dispatched_qty, i.unit_price, i.subtotal))
              .ToList();

        return new StockRequestDto(
            r.Id, r.Code,
            r.Shop_Id, r.Shop_Code, r.Shop_Name,
            r.Inventory_Id, r.Inventory_Code, r.Inventory_Name,
            r.Submitted_By_Name, r.Approved_By_Name, r.Dispatched_By_Name, r.Received_By_Name,
            r.Status, r.Total_Items, r.Total_Qty, r.Total_Dispatched_Qty, r.Total_Amount, r.Total_Dispatched_Amount,
            r.Notes, r.Rejection_Reason,
            r.Editable_Until, r.Submitted_At,
            r.Approved_At, r.Approved_By,
            r.Dispatched_At, r.Dispatched_By,
            r.Received_At, r.Cancelled_At, r.Cancelled_By,
            items);
    }

    private static readonly JsonSerializerOptions ReadJsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true };

    // Matches the JSON keys returned by fn_request_get's jsonb_build_object.
    private sealed record RawItem(
        Guid id, Guid product_id, string product_code, string product_name,
        decimal? weight_value, string? weight_unit,
        int requested_qty, int? dispatched_qty, decimal unit_price, decimal subtotal);
}
