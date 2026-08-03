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
    // Default the close window to [last close closed_at OR IST midnight, now].
    // IST is fixed UTC+5:30 — India doesn't observe DST, so the offset is safe
    // to hard-code (same convention as BillService's ist_offset).
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    public async Task<EodExpectedDto> ExpectedAsync(
        DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct = default)
    {
        var shopId = RequireShopId();

        var now      = DateTimeOffset.UtcNow;
        var windowTo = to ?? now;
        var windowFrom = from ?? await ResolveDefaultFromAsync(shopId, windowTo, ct);
        if (windowFrom >= windowTo)
            throw new Exceptions.ValidationException(new[] {
                new FluentValidation.Results.ValidationFailure("window",
                    "Close window must span forward in time.")
            });

        var e = await eod.ExpectedAsync(shopId, windowFrom, windowTo, ct);
        return new EodExpectedDto(
            windowFrom, windowTo,
            e.Cash_Sales, e.Upi_Sales, e.Credit_Sales,
            e.Cash_Refunds, e.Upi_Refunds, e.Cancel_Cash_Back,
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
            return await eod.CloseAsync(
                shopId, userId, request.WindowFrom, request.WindowTo,
                denomJson, string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(), ct);
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
            r.Expected_Cash, r.Physical_Cash, r.Variance, r.Notes)).ToList();
    }

    // ── Helpers ───────────────────────────────────────────────────────

    private async Task<DateTimeOffset> ResolveDefaultFromAsync(
        Guid shopId, DateTimeOffset windowTo, CancellationToken ct)
    {
        // Prefer "since last close" so a mid-day EOD only counts new bills.
        var lastClose = await eod.LastCloseAtAsync(shopId, ct);
        // IST midnight of the same calendar day as windowTo (so a next-morning
        // close correctly folds yesterday's late-night bills together).
        var istNow  = windowTo.ToOffset(IstOffset);
        var midnight = new DateTimeOffset(
            istNow.Year, istNow.Month, istNow.Day, 0, 0, 0, IstOffset);
        return lastClose.HasValue && lastClose.Value > midnight ? lastClose.Value : midnight;
    }

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can run EOD.");

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");
}
