using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Customers;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using Npgsql;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

/// <summary>
/// Phase 4b — customers + credit (features #6 + #4). ShopUser only; shop_id
/// always resolves from the JWT claim, never a caller value — same ownership
/// shape as BillService.
/// </summary>
public class CustomerService(
    ICustomerRepository customers,
    ICurrentUser currentUser,
    IValidator<CreateCustomerRequest> createValidator,
    IValidator<SettleCreditRequest> settleValidator
) : ICustomerService
{
    public async Task<CustomerDto?> LookupAsync(string phone, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var shopId = RequireShopId();
        var c = await customers.LookupAsync(shopId, phone.Trim(), ct);
        return c is null ? null : Map(c);
    }

    public async Task<CustomerDto> CreateAsync(CreateCustomerRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();
        try
        {
            var c = await customers.CreateAsync(
                shopId, userId, request.Name.Trim(), request.Phone.Trim(), request.CreditLimit, ct);
            return Map(c);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            throw CustomerErrors.Validation(ex.MessageText);
        }
    }

    public async Task<PagedResult<CustomerDto>> ListAsync(
        string? search, int page, int pageSize, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await customers.ListAsync(shopId, Normalize(search), page, pageSize, ct);
        var total = rows.Count > 0 ? rows[0].Total_Count : 0;
        return new PagedResult<CustomerDto>(rows.Select(Map).ToList(), total, page, pageSize);
    }

    public async Task<decimal> SettleAsync(
        Guid customerId, SettleCreditRequest request, CancellationToken ct = default)
    {
        var validation = await settleValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var shopId = RequireShopId();
        var userId = RequireUserId();
        try
        {
            return await customers.SettleAsync(
                customerId, shopId, userId, request.Amount, request.Mode, Normalize(request.Note), ct);
        }
        catch (PostgresException ex) when (ex.SqlState == "P0001")
        {
            if (ex.MessageText.Contains("not found", StringComparison.OrdinalIgnoreCase))
                throw new NotFoundException(ex.MessageText);
            throw CustomerErrors.Validation(ex.MessageText);
        }
    }

    public async Task<PagedResult<CustomerLedgerEntryDto>> LedgerAsync(
        Guid customerId, int page, int pageSize, CancellationToken ct = default)
    {
        var shopId = RequireShopId();
        var rows = await customers.LedgerAsync(customerId, shopId, page, pageSize, ct);
        var total = rows.Count > 0 ? rows[0].Total_Count : 0;
        var items = rows.Select(r => new CustomerLedgerEntryDto(
            r.Id, r.Entry_Type, r.Amount, r.Mode, r.Note, r.Balance_After,
            r.Bill_Code, r.Created_At, r.Created_By_Name)).ToList();
        return new PagedResult<CustomerLedgerEntryDto>(items, total, page, pageSize);
    }

    // ───────── Helpers ─────────

    private static CustomerDto Map(Customer c) =>
        new(c.Id, c.Code, c.Name, c.Phone, c.Credit_Limit, c.Credit_Balance);

    private Guid RequireShopId()
        => currentUser.ShopId ?? throw new ForbiddenException("Only shop users can manage customers.");

    private Guid RequireUserId()
        => currentUser.UserId ?? throw new UnauthorizedException("Authenticated user required.");

    private static string? Normalize(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

internal static class CustomerErrors
{
    public static ValidationException Validation(string message)
        => new(new[] { new ValidationFailure(string.Empty, message) });
}
