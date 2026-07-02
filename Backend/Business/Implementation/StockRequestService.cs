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
    IValidator<DispatchRequest> dispatchValidator,
    IValidator<CreateReturnRequest> createReturnValidator,
    IValidator<AcceptReturnRequest> acceptReturnValidator,
    IValidator<EditDispatchedQtyRequest> editDispatchedQtyValidator
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
        string? requestType = null,
        CancellationToken ct = default)
    {
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 10 : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await requests.ListPagedAsync(
            shopId, inventoryId, status, search, safePage, safePageSize, fromDate, toDate, requestType, ct);
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
        Guid? inventoryId,
        IReadOnlyList<Guid>? requestIds = null,
        CancellationToken ct = default)
    {
        // Role gates:
        //   • ShopUser  → never (they don't pack batches).
        //   • Inventory → forced to their own inventory; ignore any explicit
        //                 inventoryId param to prevent cross-godown peeking.
        //   • Admin     → may pass any inventoryId or NULL for tenant-wide total.
        if (IsRole(RoleNames.ShopUser))
            throw new ForbiddenException("Shop users cannot view the cumulative report.");

        Guid? scope = IsRole(RoleNames.Inventory) ? currentUser.InventoryId : inventoryId;

        // requestIds is a client-side "select the specific requests to include"
        // filter (02-Jul-2026). Normalise empty array → null so the SP treats
        // it as "no filter". Inventory scope guard above still applies —
        // rows for requests outside the caller's inventory are silently
        // filtered out even if their id is in the array.
        var ids = requestIds is { Count: > 0 } ? requestIds : null;

        var rows = await requests.GetPendingCumulativeAsync(scope, ids, ct);
        return rows.Select(r => new CumulativePendingLineDto(
            r.Product_Id, r.Product_Code, r.Product_Name, r.Category_Name, r.Type,
            r.Weight_Value, r.Weight_Unit, r.Total_Qty, r.Request_Count)).ToList();
    }

    public async Task<IReadOnlyList<ShopRequestCountDto>> GetCountByShopAsync(
        string? status, Guid? inventoryId,
        DateOnly? fromDate = null, DateOnly? toDate = null,
        string? requestType = null,
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

        var rows = await requests.GetCountByShopAsync(status, scope, fromDate, toDate, requestType, ct);
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

        // Compute editable_until. When request_lock_enabled = false, the shop
        // can edit anytime — set a far-future timestamp so the FE chip / the
        // service's own UpdateAsync time-window check never fires. Otherwise
        // use the daily IST cutoff (request_lock_cutoff).
        DateTimeOffset editableUntil;
        if (await IsRequestLockEnabledAsync(ct))
        {
            var cutoffStr = (await settings.GetAsync("request_lock_cutoff", ct))?.Value ?? "09:00";
            editableUntil = ComputeEditableUntil(cutoffStr);
        }
        else
        {
            // 100-year horizon — same value the Returns flow uses to mean
            // "editing window is effectively unlimited".
            editableUntil = DateTimeOffset.UtcNow.AddYears(100);
        }

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

    public async Task<StockRequestDto> RenameDispatchDraftAsync(
        Guid id, RenameDispatchDraftRequest request, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Same scope rule as save/clear — inventory can only rename drafts on
        // their own godown's requests; admin may rename any. Any godown user
        // can rename (no created-by lock — dispatch is a shared workload).
        EnsureInventoryScope(existing);

        // Trim + null-empty here so the SP gets a clean value: NULL means
        // "clear the label", any non-null string means "set to this".
        // Length cap matches the DB column (varchar(60)); BE truncates with
        // a validation error rather than silently chopping.
        var normalized = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim();
        if (normalized is { Length: > 60 })
        {
            throw new ValidationException(new[] {
                new ValidationFailure("name", "Draft name cannot exceed 60 characters.")
            });
        }

        var ok = await requests.RenameDispatchDraftAsync(id, userId, normalized, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot rename dispatch draft — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> PinDispatchDraftAsync(
        Guid id, PinDispatchDraftRequest request, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Same scope rule as the other draft SPs — inventory can only pin
        // drafts on their own godown's requests; admin may pin any.
        EnsureInventoryScope(existing);

        var ok = await requests.PinDispatchDraftAsync(id, userId, request.Pinned, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot pin dispatch draft — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> InventoryAddItemsAsync(
        Guid id, InventoryAddItemsRequest request, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        if (request.Items is null || request.Items.Count == 0)
        {
            throw new ValidationException(new[] {
                new ValidationFailure("items", "At least one product is required.")
            });
        }

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Inventory can only add to their own godown's requests; admin may
        // add to any. Returns aren't part of this flow — inventory Add
        // Products is Order-only (Returns follow the accept-return path).
        EnsureInventoryScope(existing);
        if (existing.Request_Type == "Return")
        {
            throw new ValidationException(new[] {
                new ValidationFailure("requestType",
                    "Cannot add items to a Return — this endpoint is Order-only.")
            });
        }

        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            product_id     = i.ProductId,
            requested_qty  = i.RequestedQty,
        }), JsonOpts);

        var ok = await requests.InventoryAddItemsAsync(id, userId, itemsJson, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot add items — request is in '{existing.Status}' state.")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> InventoryRemoveItemAsync(
        Guid id, Guid itemId, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");
        EnsureInventoryScope(existing);

        var ok = await requests.InventoryRemoveItemAsync(id, itemId, userId, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("itemId",
                "Cannot remove — item not found, or it wasn't added by inventory, or the request is no longer editable.")
        });
        return await GetAsync(id, ct);
    }

    // ───────── Return Stock ─────────

    public async Task<StockRequestDto> CreateReturnAsync(CreateReturnRequest request, CancellationToken ct = default)
    {
        var validation = await createReturnValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        // ShopUser only — Returns originate from the shop side, mirroring how
        // Orders are created. Inventory/Admin should not create Returns on a
        // shop's behalf (would obscure the audit trail).
        var shopId = currentUser.ShopId
            ?? throw new ForbiddenException("Only shop users can create returns.");

        var shop = await shops.GetAsync(shopId, ct)
            ?? throw new NotFoundException("Your shop record was not found.");

        // Validate the linked Order (if any): exists, belongs to this shop,
        // is an Order (not another Return), and is Received (terminal — only
        // received goods can be physically returned).
        Guid inventoryIdForReturn = shop.InventoryId;
        if (request.SourceRequestId is Guid sourceId)
        {
            var source = await requests.GetAsync(sourceId, ct)
                ?? throw new NotFoundException($"Source request '{sourceId}' not found.");

            if (source.Shop_Id != shopId)
                throw new ForbiddenException("Source request does not belong to your shop.");
            if (!string.Equals(source.Request_Type, "Order", StringComparison.OrdinalIgnoreCase))
                throw new ValidationException(new[]
                {
                    new ValidationFailure(nameof(request.SourceRequestId),
                        "Source must be an Order, not another Return.")
                });
            if (!string.Equals(source.Status, "Received", StringComparison.OrdinalIgnoreCase))
                throw new ValidationException(new[]
                {
                    new ValidationFailure(nameof(request.SourceRequestId),
                        $"Source order must be Received. Current state: '{source.Status}'.")
                });

            // Route the Return to the SAME godown that fulfilled the source
            // Order — physical movement matches.
            inventoryIdForReturn = source.Inventory_Id;
        }

        // Build items JSON (same shape as Orders: product_id, requested_qty,
        // unit_price snapshot). Phase 3 reads unit_price to reverse the
        // ledger entry at the exact price the goods were sold for.
        var itemsJson = await BuildItemsJsonAsync(request.Items, ct);

        var code = await requests.NextCodeAsync(ct);
        var newId = await requests.CreateReturnAsync(
            code, shop.Id, inventoryIdForReturn,
            request.SourceRequestId, request.Notes,
            itemsJson, userId, ct);

        return await GetAsync(newId, ct);
    }

    public async Task<StockRequestDto> AcceptReturnAsync(Guid id, AcceptReturnRequest request, CancellationToken ct = default)
    {
        var validation = await acceptReturnValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        // Inventory user can only accept Returns routed to their own godown.
        EnsureInventoryScope(existing);

        // Defensive: the SP also guards by request_type, but surface a clearer
        // BE-side error if someone calls Accept on a non-Return.
        if (!string.Equals(existing.Request_Type, "Return", StringComparison.OrdinalIgnoreCase))
            throw new ValidationException(new[]
            {
                new ValidationFailure("requestType",
                    "Accept is only valid for Returns. This request is an Order.")
            });

        // AcceptedQty maps to dispatched_qty in the SP (column reuse).
        var itemsJson = JsonSerializer.Serialize(request.Items.Select(i => new
        {
            id              = i.Id,
            dispatched_qty  = i.AcceptedQty,
        }), JsonOpts);

        var ok = await requests.AcceptReturnAsync(id, userId, itemsJson, ct);
        if (!ok) throw new ValidationException(new[] {
            new ValidationFailure("status",
                $"Cannot accept — return is in '{existing.Status}' state (must be Pending).")
        });
        return await GetAsync(id, ct);
    }

    public async Task<StockRequestDto> EditDispatchedQtyAsync(
        Guid requestId, Guid itemId, EditDispatchedQtyRequest request, CancellationToken ct = default)
    {
        // Admin-only — the controller already attributes [Authorize(Roles=...)],
        // but we guard service-side too so this can't be reused from a less
        // restrictive endpoint by mistake.
        if (!IsRole(RoleNames.Admin))
            throw new ForbiddenException("Only admins can edit dispatched quantity after completion.");

        var validation = await editDispatchedQtyValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(requestId, ct)
            ?? throw new NotFoundException($"Stock request '{requestId}' not found.");

        // Status guard surfaced BE-side so the FE can show a clean message;
        // the SP enforces the same rule defensively.
        if (existing.Status != "Received" && existing.Status != "Accepted")
            throw new ValidationException(new[]
            {
                new ValidationFailure("status",
                    $"Cannot edit dispatched qty — request is in '{existing.Status}' state " +
                    "(must be Received or Accepted).")
            });

        // We don't BE-validate that itemId belongs to requestId — the SP
        // resolves request_id from the item itself, so the audit row always
        // lands on the correct parent regardless of what URL was used.
        var ok = await requests.EditDispatchedQtyAsync(itemId, request.NewQty, request.Reason, userId, ct);
        if (!ok) throw new ValidationException(new[]
        {
            new ValidationFailure("newQty",
                "Could not save — qty is out of range, or the request is no longer editable.")
        });

        return await GetAsync(requestId, ct);
    }

    // ───────── Back-order (02-Jul-2026) ─────────

    public async Task<StockRequestDto> MoveToBackorderAsync(
        Guid id, MoveToBackorderRequest request, CancellationToken ct = default)
    {
        // Godown-only action. Admin allowed too (matches other dispatch-side ops).
        if (IsRole(RoleNames.ShopUser))
            throw new ForbiddenException("Shop users cannot move items to back-order.");

        if (request.Items is null || request.Items.Count == 0)
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Items),
                    "Select at least one item to move to back-order.")
            });

        if (request.Items.Any(i => i.Qty <= 0))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Items),
                    "Every item's back-order qty must be positive.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await requests.GetAsync(id, ct)
            ?? throw new NotFoundException($"Stock request '{id}' not found.");

        EnsureInventoryScope(existing);

        // The SP defensively re-guards these but we surface FE-friendly messages here.
        if (!string.Equals(existing.Request_Type, "Order", StringComparison.OrdinalIgnoreCase))
            throw new ValidationException(new[] {
                new ValidationFailure("requestType",
                    "Move to back-order is only valid for Orders.")
            });
        if (existing.Status != "Pending" && existing.Status != "Approved")
            throw new ValidationException(new[] {
                new ValidationFailure("status",
                    $"Cannot move items to back-order — request is '{existing.Status}' (must be Pending or Approved).")
            });

        // Serialise as snake_case {id, qty} to match the SP's jsonb_extract keys.
        var itemsJson = JsonSerializer.Serialize(
            request.Items.Select(i => new { id = i.Id, qty = i.Qty }),
            JsonOpts);

        // Convert to UTC — Npgsql rejects non-UTC DateTimeOffset on timestamptz.
        var eta = request.ExpectedArrivalAt?.ToUniversalTime();

        await requests.MoveToBackorderAsync(id, itemsJson, eta, userId, ct);

        // Return the refreshed PARENT — the FE detail page for the parent is
        // where the godown pressed the button, so this is what should re-render.
        // Child detail is fetched separately when the shop clicks the banner.
        return await GetAsync(id, ct);
    }

    public async Task<IReadOnlyList<OutstandingBackorderDto>> ListOutstandingBackordersAsync(
        Guid? inventoryId, CancellationToken ct = default)
    {
        // ShopUser  → forced to own shop; Inventory → forced to own godown; Admin free.
        Guid? scopeInv = IsRole(RoleNames.Inventory) ? currentUser.InventoryId : inventoryId;
        IReadOnlyList<Guid>? scopeShops = IsRole(RoleNames.ShopUser) && currentUser.ShopId is Guid sid
            ? new[] { sid } : null;

        var rows = await requests.ListOutstandingBackordersAsync(scopeInv, scopeShops, ct);
        return rows.Select(r => new OutstandingBackorderDto(
            r.Id, r.Code, r.Parent_Id, r.Parent_Code,
            r.Shop_Id, r.Shop_Code, r.Shop_Name,
            r.Inventory_Id, r.Inventory_Name,
            r.Total_Items, r.Total_Qty, r.Total_Amount,
            r.Submitted_At, r.Expected_Arrival_At,
            r.Days_Since_Submitted)).ToList();
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
            r.Shop_Id, r.Shop_Code, r.Shop_Name, r.Shop_Contact_Phone,
            r.Inventory_Id, r.Inventory_Code, r.Inventory_Name,
            r.Submitted_By_Name, r.Approved_By_Name, r.Dispatched_By_Name, r.Received_By_Name,
            r.Accepted_By_Name,
            r.Status, r.Request_Type,
            r.Total_Items, r.Total_Qty, r.Total_Dispatched_Qty, r.Total_Amount, r.Total_Dispatched_Amount,
            r.Notes, r.Rejection_Reason,
            r.Editable_Until, r.Submitted_At, r.Updated_At,
            r.Approved_At, r.Approved_By,
            r.Dispatched_At, r.Dispatched_By,
            r.Received_At,
            r.Accepted_At, r.Accepted_By,
            r.Cancelled_At, r.Cancelled_By,
            r.Source_Request_Id, r.Source_Request_Code,
            r.Draft_Name, r.Pinned_At,
            r.Parent_Request_Id, r.Parent_Request_Code, r.Expected_Arrival_At,
            BackorderChildren: ParseBackorderChildren(r.Backorder_Children),
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
            i.unit_price, i.subtotal,
            i.added_by ?? "Shop",
            i.is_vendor_procured ?? false)).ToList();
    }

    /// Deserialise the backorder_children JSON aggregate from fn_request_get.
    /// Null / empty / "[]" → null on the DTO so the FE can distinguish
    /// "no children" from "children not fetched" on list rows.
    private static List<BackorderChildDto>? ParseBackorderChildren(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.Trim() == "[]")
            return null;

        var raws = JsonSerializer.Deserialize<List<RawBackorderChild>>(json, JsonOpts);
        if (raws is null || raws.Count == 0) return null;

        return raws.Select(c => new BackorderChildDto(
            c.id, c.code, c.status, c.total_items, c.total_qty, c.total_amount,
            c.expected_arrival_at, c.submitted_at)).ToList();
    }

    // Matches the JSON keys returned by fn_request_get's jsonb_build_object.
    private sealed record RawItem(
        Guid id, Guid product_id, string product_code, string product_name,
        string category_name,
        decimal? weight_value, string? weight_unit,
        int requested_qty, int? dispatched_qty, int? draft_dispatched_qty,
        decimal unit_price, decimal subtotal,
        string? added_by,
        bool?   is_vendor_procured);

    private sealed record RawBackorderChild(
        Guid id, string code, string status,
        int total_items, int total_qty, decimal total_amount,
        DateTimeOffset? expected_arrival_at,
        DateTimeOffset  submitted_at);
}
