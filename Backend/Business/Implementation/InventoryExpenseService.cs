using FluentValidation;
using KovilpattiSnacks.Business.DTOs.InventoryExpenses;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Phase 4 — inventory / godown operating expenses (21-Jul-2026 client req).
/// Inventory user only; every method resolves inventory_id from the current
/// JWT claim (never a caller-supplied value), and Update/Delete double-check
/// the target row actually belongs to that inventory before touching it —
/// same ownership-guard shape as ShopUtilityExpenseService for shops.
///
/// Admin users are explicitly forbidden per the 21-Jul-2026 spec — the
/// owner delegates entirely to godown staff for godown expenses. Admin
/// still SEES totals via the Accounts screen but cannot create / update /
/// delete rows here.
/// </summary>
public class InventoryExpenseService(
    IInventoryExpenseRepository expenses,
    ICurrentUser currentUser,
    IValidator<CreateInventoryExpenseRequest> createValidator,
    IValidator<UpdateInventoryExpenseRequest> updateValidator
) : IInventoryExpenseService
{
    public async Task<IReadOnlyList<InventoryExpenseDto>> ListAsync(
        DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        var inventoryId = RequireInventoryId();
        var rows = await expenses.ListAsync(inventoryId, fromDate, toDate, ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<InventoryExpenseDto> CreateAsync(CreateInventoryExpenseRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var inventoryId = RequireInventoryId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var created = await expenses.CreateAsync(
            inventoryId, request.Category.Trim(), request.Amount, Normalize(request.Note), request.ExpenseDate, userId, ct);
        return MapToDto(created);
    }

    public async Task<InventoryExpenseDto> UpdateAsync(Guid id, UpdateInventoryExpenseRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var inventoryId = RequireInventoryId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await expenses.GetAsync(id, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        EnsureInventoryScope(existing, inventoryId);

        var updated = await expenses.UpdateAsync(
            id, request.Category.Trim(), request.Amount, Normalize(request.Note), request.ExpenseDate, userId, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        return MapToDto(updated);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var inventoryId = RequireInventoryId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await expenses.GetAsync(id, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        EnsureInventoryScope(existing, inventoryId);

        await expenses.SoftDeleteAsync(id, userId, ct);
    }

    // ───────── Helpers ─────────

    private Guid RequireInventoryId()
        => currentUser.InventoryId ?? throw new ForbiddenException("Only inventory users can manage inventory expenses.");

    private static void EnsureInventoryScope(InventoryExpense existing, Guid inventoryId)
    {
        if (existing.Inventory_Id != inventoryId)
            throw new ForbiddenException("This expense does not belong to your godown.");
    }

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static InventoryExpenseDto MapToDto(InventoryExpense e)
        => new(e.Id, e.Inventory_Id, e.Category, e.Amount, e.Note, e.Expense_Date, e.Created_At, e.Updated_At);
}
