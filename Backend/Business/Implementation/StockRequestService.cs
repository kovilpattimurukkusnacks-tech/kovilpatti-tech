using System.Text.Json;
using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.Constants;
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

    // snake_case writes (matching the SPs' jsonb_extract keys) + case-insensitive
    // reads. Shared by both serialize and deserialize paths.
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    // ───────── Read ─────────

    public async Task<PagedResult<StockRequestDto>> ListAsync(
        Guid? shopId, Guid? inventoryId, string? status, string? search,
        int page, int pageSize,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        CancellationToken ct = default)
    {
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 10 : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await requests.ListPagedAsync(
            shopId, inventoryId, status, search, safePage, safePageSize, fromDate, toDate, ct);
        var items = rows.Select(MapHeaderToDto).ToList();
        return new PagedResult<StockRequestDto>(items, total, safePage, safePageSize);
    }

    public async Task<StockRequestDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var row = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Role-based access: shop users only see their own; inventory users only their inventory's; admin sees all.
        EnsureShopScope(row);
        EnsureInventoryScope(row);

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
        if (IsRole(RoleNames.ShopUser))
            throw new ForbiddenException("Shop users cannot view the cumulative report.");

        Guid? scope = IsRole(RoleNames.Inventory) ? currentUser.InventoryId : inventoryId;

        var rows = await requests.GetPendingCumulativeAsync(scope, ct);
        return rows.Select(r => new CumulativePendingLineDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.Category_Name, r.Type,
            r.Weight_Value, r.Weight_Unit, r.Total_Qty, r.Request_Count)).ToList();
    }

    public async Task<IReadOnlyList<ShopRequestCountDto>> GetCountByShopAsync(
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        CancellationToken ct = default)
    {
        // Same role gating as GetPendingCumulativeAsync:
        //   • ShopUser  → never (this is a cross-shop summary; not useful to them).
        //   • Inventory → forced to their own inventory; ignore any caller-supplied
        //                 inventoryId to prevent peeking into other godowns.
        //   • Admin     → may pass any inventoryId or NULL for tenant-wide totals.
        if (IsRole(RoleNames.ShopUser))
            throw new ForbiddenException("Shop users cannot view the per-shop summary.");

        Guid? scope = IsRole(RoleNames.Inventory) ? currentUser.InventoryId : inventoryId;

        var rows = await requests.GetCountByShopAsync(status, scope, fromDate, toDate, ct);
        return rows.Select(r => new ShopRequestCountDto(
            r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Request_Count)).ToList();
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

        // Compute editable_until from the configured cutoff.
        var cutoffStr = (await settings.GetAsync("request_lock_cutoff", ct))?.Value ?? "09:00";
        var editableUntil = ComputeEditableUntil(cutoffStr);

        var itemsJson = await BuildItemsJsonAsync(request.Items, ct);

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
        var isAdmin = IsRole(RoleNames.Admin);

        if (IsRole(RoleNames.ShopUser))
        {
            EnsureShopScope(existing);

            // request_lock_enabled = 'false' disables the cutoff window entirely.
            // Status rule (Pending only for shop users) still applies below.
            if (await IsRequestLockEnabledAsync(ct))
            {
                var nowIst = DateTimeOffset.UtcNow.ToOffset(IstOffset);
                if (nowIst > existing.Editable_Until)
                    throw new ValidationException(new[]
                    {
                        new ValidationFailure("editable_until",
                            "Edit window has closed. This request is now locked. Only an admin can modify it.")
                    });
            }
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

        var itemsJson = await BuildItemsJsonAsync(request.Items, ct);

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
        EnsureInventoryScope(existing);

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
        EnsureInventoryScope(existing);

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
        EnsureInventoryScope(existing);

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
        EnsureInventoryScope(existing);

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
        EnsureShopScope(existing);

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
        if (IsRole(RoleNames.ShopUser))
        {
            EnsureShopScope(existing);

            // Same flag governs cancel as governs edit — both are "shop modifies
            // their Pending request" actions.
            if (await IsRequestLockEnabledAsync(ct))
            {
                var nowIst = DateTimeOffset.UtcNow.ToOffset(IstOffset);
                if (nowIst > existing.Editable_Until)
                    throw new ValidationException(new[] {
                        new ValidationFailure("editable_until",
                            "Edit window has closed. Ask an admin to cancel this request.")
                    });
            }
        }
        else if (!IsRole(RoleNames.Admin))
        {
            throw new ForbiddenException("Only the shop's user or an admin can cancel a request.");
        }

        var ok = await requests.CancelAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status", $"Cannot cancel — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    // ───────── Shop drafts ─────────

    public async Task<StockRequestDto> SaveShopDraftAsync(
        CreateStockRequestRequest request, CancellationToken ct = default)
    {
        // Reuse the create-request validator — payload shape and constraints
        // (≥1 item, qty > 0, etc.) are identical to a finalised submit.
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var shopId = currentUser.ShopId
            ?? throw new ForbiddenException("Only shop users can save drafts.");

        var shop = await shops.GetAsync(shopId, ct)
            ?? throw new NotFoundException("Your shop record was not found.");

        var itemsJson = await BuildItemsJsonAsync(request.Items, ct);

        var draftId = await requests.SaveShopDraftAsync(
            shop.Id, shop.InventoryId, request.Notes, itemsJson, userId, ct);

        return await GetAsync(draftId, ct);
    }

    public async Task<StockRequestDto?> GetShopDraftAsync(CancellationToken ct = default)
    {
        var shopId = currentUser.ShopId
            ?? throw new ForbiddenException("Only shop users have drafts.");

        var row = await requests.GetShopDraftAsync(shopId, ct);
        return row is null ? null : MapWithItems(row);
    }

    public async Task<bool> DeleteShopDraftAsync(CancellationToken ct = default)
    {
        var shopId = currentUser.ShopId
            ?? throw new ForbiddenException("Only shop users have drafts.");

        return await requests.DeleteShopDraftAsync(shopId, ct);
    }

    // ───────── Inventory dispatch draft ─────────

    public async Task<IReadOnlyList<StockRequestDto>> ListInventoryDispatchDraftsAsync(
        Guid? inventoryId, CancellationToken ct = default)
    {
        // Same role gates as the cumulative + count-by-shop endpoints:
        //   • ShopUser  → never (no concept of inventory drafts for them).
        //   • Inventory → forced to their own godown; ignore caller param.
        //   • Admin     → may pass any inventoryId or NULL for tenant-wide.
        if (IsRole(RoleNames.ShopUser))
            throw new ForbiddenException("Shop users cannot view inventory drafts.");

        Guid? scope = IsRole(RoleNames.Inventory) ? currentUser.InventoryId : inventoryId;

        var rows = await requests.ListInventoryDispatchDraftsAsync(scope, ct);
        return rows.Select(MapHeaderToDto).ToList();
    }

    public async Task<StockRequestDto> ClearDispatchDraftAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Same scope rule as save/dispatch — inventory only their own godown.
        EnsureInventoryScope(existing);

        var ok = await requests.ClearDispatchDraftAsync(id, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot discard dispatch draft — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> SaveDispatchDraftAsync(
        Guid id, DispatchRequest request, CancellationToken ct = default)
    {
        var validation = await dispatchValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Same scope rule as DispatchAsync — inventory can only save drafts
        // for their own godown's requests; admin may save for any.
        EnsureInventoryScope(existing);

        // Same payload shape as DispatchAsync; SP writes to draft_dispatched_qty
        // instead of dispatched_qty and leaves status unchanged.
        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            id              = i.Id,
            dispatched_qty  = i.DispatchedQty,
        }), JsonOpts);

        var ok = await requests.SaveDispatchDraftAsync(id, userId, itemsJson, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot save dispatch draft — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    // ───────── Helpers ─────────

    private bool IsRole(string role)
        => string.Equals(currentUser.Role, role, StringComparison.OrdinalIgnoreCase);

    // Throws Forbidden if the current user is a ShopUser and the row doesn't belong to their shop.
    // No-op for Inventory/Admin roles (their own scope check below handles them).
    private void EnsureShopScope(StockRequest existing)
    {
        if (IsRole(RoleNames.ShopUser) && currentUser.ShopId != existing.Shop_Id)
            throw new ForbiddenException("This request does not belong to your shop.");
    }

    // Throws Forbidden if the current user is an Inventory user and the row is for a different inventory.
    // No-op for ShopUser/Admin roles.
    private void EnsureInventoryScope(StockRequest existing)
    {
        if (IsRole(RoleNames.Inventory) && currentUser.InventoryId != existing.Inventory_Id)
            throw new ForbiddenException("This request is for a different inventory.");
    }

    // Build the items JSON payload consumed by fn_request_create / _update /
    // _save_shop_draft. Each call resolves product MRPs (snapshot at submit time)
    // and emits snake_case keys for the SPs' jsonb_extract_path lookups.
    private async Task<string> BuildItemsJsonAsync(
        IReadOnlyList<CreateStockRequestItem> items, CancellationToken ct)
    {
        var productMap = await ResolveAndValidateProducts(
            items.Select(i => i.ProductId).ToHashSet(), ct);

        return JsonSerializer.Serialize(items.Select(i => new
        {
            product_id    = i.ProductId,
            requested_qty = i.RequestedQty,
            unit_price    = productMap[i.ProductId].Mrp,
        }), JsonOpts);
    }

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

    // Reads the request_lock_enabled flag from app_settings. Defaults to true if
    // missing or unparseable — preserves the pre-flag behaviour on any environment
    // that hasn't run the new migration yet.
    private async Task<bool> IsRequestLockEnabledAsync(CancellationToken ct)
    {
        var raw = (await settings.GetAsync("request_lock_enabled", ct))?.Value;
        // Treat only the literal "false" (case-insensitive) as disabled. Anything
        // else (missing row, "true", typo) leaves the lock on for safety.
        return !string.Equals(raw, "false", StringComparison.OrdinalIgnoreCase);
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
            r.Editable_Until, r.Submitted_At, r.Updated_At,
            r.Approved_At, r.Approved_By,
            r.Dispatched_At, r.Dispatched_By,
            r.Received_At, r.Cancelled_At, r.Cancelled_By,
            Items: null);

    // Composes MapHeaderToDto with the deserialised items list. Single source
    // of truth for the 28 header fields — adding a new DTO field only needs
    // updating MapHeaderToDto, not both.
    private static StockRequestDto MapWithItems(StockRequest r)
        => MapHeaderToDto(r) with { Items = ParseItems(r.Items) };

    private static List<StockRequestItemDto> ParseItems(string? itemsJson)
    {
        if (string.IsNullOrWhiteSpace(itemsJson))
            return new List<StockRequestItemDto>();

        var raws = JsonSerializer.Deserialize<List<RawItem>>(itemsJson, JsonOpts)
                   ?? new List<RawItem>();

        return raws.Select(i => new StockRequestItemDto(
            i.id, i.product_id, i.product_code, i.product_name, i.category_name,
            i.weight_value, i.weight_unit,
            i.requested_qty, i.dispatched_qty, i.draft_dispatched_qty,
            i.unit_price, i.subtotal)).ToList();
    }

    // Matches the JSON keys returned by fn_request_get's jsonb_build_object.
    private sealed record RawItem(
        Guid id, Guid product_id, string product_code, string product_name,
        string category_name,
        decimal? weight_value, string? weight_unit,
        int requested_qty, int? dispatched_qty, int? draft_dispatched_qty,
        decimal unit_price, decimal subtotal);
}
