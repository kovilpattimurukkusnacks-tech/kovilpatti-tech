using System.Text.Json;
using FluentValidation;
using KovilpattiSnacks.Business.DTOs.Eod;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Interface;
using Npgsql;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class EodService(
    IEodRepository eod,
    ICurrentUser currentUser,
    IValidator<EodCloseRequest> closeValidator
) : IEodService
{
    public async Task<EodExpectedDto> ExpectedAsync(CancellationToken ct = default)
    {
        var shopId = RequireShopId();

        // 25-Sep-2026: same window fn_eod_close will use — previous close (or
        // first billing activity) → now. A client-chosen "from" could skip
        // sales or overlap the previous close.
        var windowFrom = await eod.WindowFromAsync(shopId, ct);
        var windowTo   = DateTimeOffset.UtcNow;
        if (windowFrom > windowTo) windowFrom = windowTo;

        var e = await eod.ExpectedAsync(shopId, windowFrom, windowTo, ct);
        return new EodExpectedDto(
            windowFrom, windowTo,
            e.Cash_Sales, e.Upi_Sales, e.Credit_Sales,
            e.Cash_Refunds, e.Upi_Refunds, e.Cancel_Cash_Back,
            e.Cancel_Upi_Back, e.Cash_Settlements, e.Upi_Settlements,
            e.Expected_Cash, e.Bill_Count, e.Return_Count, e.Cancel_Count);
    }

    public async Task<Guid> CloseAsync(EodCloseRequest request, CancellationToken ct = default)
    {
        var validation = await closeValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();

        var denomJson = JsonSerializer.Serialize(
            request.Denominations.Select(d => new { denomination = d.Denomination, count = d.Count }));

        try
        {
            // request.WindowFrom / WindowTo are ignored — fn_eod_close decides.
            return await eod.CloseAsync(
                shopId, userId, denomJson,
                string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(), ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            throw new Exceptions.ValidationException(new[] {
                new FluentValidation.Results.ValidationFailure("close", ex.MessageText)
            });
        }
    }

    public async Task<IReadOnlyList<EodSessionListItemDto>> RecentAsync(int limit, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await eod.ListAsync(shopId, Math.Clamp(limit, 1, 100), ct);
        return rows.Select(r => new EodSessionListItemDto(
            r.Id, r.Window_From, r.Closed_At, r.Closed_By_Name,
            r.Cash_Sales, r.Upi_Sales, r.Credit_Sales,
            r.Cash_Refunds, r.Upi_Refunds, r.Cancel_Cash_Back,
            r.Cancel_Upi_Back, r.Cash_Settlements, r.Upi_Settlements,
            r.Expected_Cash, r.Physical_Cash, r.Variance, r.Notes)).ToList();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can run EOD.");

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");
}
