using FluentValidation;
using KovilpattiSnacks.Business.DTOs.ShopUtilityExpenses;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Phase 4 — shop utility / operating expenses. ShopUser only; every method
/// resolves shop_id from the current JWT claim (never a caller-supplied
/// value), and Update/Delete double-check the target row actually belongs
/// to that shop before touching it — same ownership-guard shape as
/// StockRequestService's EnsureShopScope.
/// </summary>
public class ShopUtilityExpenseService(
    IShopUtilityExpenseRepository expenses,
    ICurrentUser currentUser,
    IValidator<CreateShopUtilityExpenseRequest> createValidator,
    IValidator<UpdateShopUtilityExpenseRequest> updateValidator
) : IShopUtilityExpenseService
{
    public async Task<IReadOnlyList<ShopUtilityExpenseDto>> ListAsync(
        DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await expenses.ListAsync(shopId, fromDate, toDate, ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<ShopUtilityExpenseDto> CreateAsync(CreateShopUtilityExpenseRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var created = await expenses.CreateAsync(
            shopId, request.Category.Trim(), request.Amount, Normalize(request.Note), request.ExpenseDate, userId, ct);
        return MapToDto(created);
    }

    public async Task<ShopUtilityExpenseDto> UpdateAsync(Guid id, UpdateShopUtilityExpenseRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await expenses.GetAsync(id, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        EnsureShopScope(existing, shopId);

        var updated = await expenses.UpdateAsync(
            id, request.Category.Trim(), request.Amount, Normalize(request.Note), request.ExpenseDate, userId, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        return MapToDto(updated);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var existing = await expenses.GetAsync(id, ct)
            ?? throw new NotFoundException($"Expense '{id}' not found.");
        EnsureShopScope(existing, shopId);

        await expenses.SoftDeleteAsync(id, userId, ct);
    }

    // ───────── Helpers ─────────

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can manage utility expenses.");

    private static void EnsureShopScope(ShopUtilityExpense existing, Guid shopId)
    {
        if (existing.Shop_Id != shopId)
            throw new ForbiddenException("This expense does not belong to your shop.");
    }

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static ShopUtilityExpenseDto MapToDto(ShopUtilityExpense e)
        => new(e.Id, e.Shop_Id, e.Category, e.Amount, e.Note, e.Expense_Date, e.Created_At, e.Updated_At);
}
