using FluentValidation;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Staff Salary — backs the "Salary" tab on the Admin Staff screen. Every
/// Pay/Deduct on a ShopUser writes into shop_utility_expenses (category
/// 'Staff Salary'), the exact table Admin Accounts sums, so the two screens
/// tally by construction — no separate reconciliation step. Inventory-role
/// staff have no shop_id, so their Pay/Deduct entries go into
/// staff_salary_other_transactions instead and are never reflected in
/// Accounts (it has no godown-cost concept today).
/// </summary>
public class StaffSalaryService(
    IStaffSalaryRepository staffSalaries,
    IUserRepository users,
    ICurrentUser currentUser,
    IValidator<SetStaffSalaryRequest> setValidator,
    IValidator<PaySalaryRequest> payValidator,
    IValidator<DeductSalaryRequest> deductValidator
) : IStaffSalaryService
{
    public async Task<IReadOnlyList<StaffSalaryRowDto>> ListAsync(DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var rows = await staffSalaries.GetAllAsync(from, to, ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<StaffSalaryDto> SetSalaryAsync(SetStaffSalaryRequest request, CancellationToken ct = default)
    {
        var validation = await setValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        await GetManageableStaffAsync(request.StaffId, ct);
        var userId = RequireUserId();

        var saved = await staffSalaries.SetAsync(request.StaffId, request.MonthlyAmount, request.EffectiveFrom, userId, ct);
        return new StaffSalaryDto(saved.Staff_Id, saved.Monthly_Amount, saved.Effective_From);
    }

    public async Task PayAsync(PaySalaryRequest request, CancellationToken ct = default)
    {
        var validation = await payValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var staff = await GetManageableStaffAsync(request.StaffId, ct);
        var userId = RequireUserId();
        var note = ComposeModeNote(request.Mode, request.Note);

        if (staff.Role == UserRole.ShopUser)
            await staffSalaries.CreateShopTxnAsync(staff.ShopId!.Value, staff.Id, request.Amount, note, request.TxnDate, userId, ct);
        else
            await staffSalaries.CreateOtherTxnAsync(staff.Id, request.Amount, reason: null, note, request.TxnDate, userId, ct);
    }

    public async Task DeductAsync(DeductSalaryRequest request, CancellationToken ct = default)
    {
        var validation = await deductValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var staff = await GetManageableStaffAsync(request.StaffId, ct);
        var userId = RequireUserId();
        var amount = -request.Amount;

        if (staff.Role == UserRole.ShopUser)
        {
            // shop_utility_expenses has no dedicated reason column, so fold
            // it into the note (unlike the Inventory path below, which has one).
            var note = ComposeReasonNote(request.Reason, request.Note);
            await staffSalaries.CreateShopTxnAsync(staff.ShopId!.Value, staff.Id, amount, note, request.TxnDate, userId, ct);
        }
        else
        {
            await staffSalaries.CreateOtherTxnAsync(staff.Id, amount, request.Reason, Normalize(request.Note), request.TxnDate, userId, ct);
        }
    }

    // ───────── Helpers ─────────

    /// Resolves the target staff member and confirms they're a manageable
    /// (non-admin) staff record — never trust a client-supplied shop/role.
    private async Task<User> GetManageableStaffAsync(Guid staffId, CancellationToken ct)
    {
        var staff = await users.GetByIdAsync(staffId, ct)
            ?? throw new NotFoundException($"Staff '{staffId}' not found.");
        if (staff.Role == UserRole.Admin)
            throw new ForbiddenException("Cannot manage salary for an Admin account.");
        return staff;
    }

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string ComposeModeNote(string mode, string? note)
        => string.IsNullOrWhiteSpace(note) ? $"Paid via {mode}" : $"{note.Trim()} (via {mode})";

    private static string ComposeReasonNote(string reason, string? note)
        => string.IsNullOrWhiteSpace(note) ? reason : $"{reason}: {note.Trim()}";

    private static StaffSalaryRowDto MapToDto(StaffSalaryRow r) => new(
        r.Staff_Id, r.Full_Name, r.Role, r.Shop_Id, r.Shop_Name, r.Inventory_Id, r.Inventory_Name,
        r.Monthly_Amount, r.Paid, r.Deducted, r.Net, r.In_Accounts);
}
