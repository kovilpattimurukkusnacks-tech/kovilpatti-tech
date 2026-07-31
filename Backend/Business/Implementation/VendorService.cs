using FluentValidation;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Vendors;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class VendorService(
    IVendorRepository vendors,
    ICurrentUser currentUser,
    IValidator<CreateVendorRequest> createValidator,
    IValidator<UpdateVendorRequest> updateValidator
) : IVendorService
{
    // Tamil Nadu's GST state code — the codebase's home state. A vendor
    // whose state_code differs is interstate. Same constant
    // vendor_purchases.is_interstate derives from server-side.
    private const string TamilNaduStateCode = "33";

    public async Task<IReadOnlyList<VendorDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await vendors.ListAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<PagedResult<VendorDto>> ListPagedAsync(
        int page, int pageSize, string? search = null, bool? active = null, CancellationToken ct = default)
    {
        var safePage     = page     < 1 ? 1  : page;
        var safePageSize = pageSize < 1 ? 10 : (pageSize > 200 ? 200 : pageSize);
        var (rows, total) = await vendors.ListPagedAsync(safePage, safePageSize, search, active, ct);
        return new PagedResult<VendorDto>(rows.Select(MapToDto).ToList(), total, safePage, safePageSize);
    }

    public async Task<VendorDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var v = await vendors.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor '{id}' not found.");
        return MapToDto(v);
    }

    public async Task<VendorDto> CreateAsync(CreateVendorRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var code = await vendors.NextCodeAsync(ct);

        var vendor = new Vendor
        {
            Code          = code,
            Name          = request.Name.Trim(),
            Gstin         = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant(),
            StateCode     = request.StateCode.Trim(),
            Address       = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
            ContactPerson = string.IsNullOrWhiteSpace(request.ContactPerson) ? null : request.ContactPerson.Trim(),
            ContactPhone  = string.IsNullOrWhiteSpace(request.ContactPhone) ? null : request.ContactPhone.Trim(),
            Email         = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim(),
            Active        = request.Active
        };

        var newId = await vendors.CreateAsync(vendor, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<VendorDto> UpdateAsync(Guid id, UpdateVendorRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await vendors.GetAsync(id, ct)
            ?? throw new NotFoundException($"Vendor '{id}' not found.");

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Vendor
        {
            Id            = id,
            Code          = existing.Code,
            Name          = request.Name.Trim(),
            Gstin         = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant(),
            StateCode     = request.StateCode.Trim(),
            Address       = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
            ContactPerson = string.IsNullOrWhiteSpace(request.ContactPerson) ? null : request.ContactPerson.Trim(),
            ContactPhone  = string.IsNullOrWhiteSpace(request.ContactPhone) ? null : request.ContactPhone.Trim(),
            Email         = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim(),
            Active        = request.Active
        };

        var ok = await vendors.UpdateAsync(updated, userId, ct);
        if (!ok) throw new NotFoundException($"Vendor '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await vendors.SoftDeleteAsync(id, userId, ct);
        if (!ok) throw new NotFoundException($"Vendor '{id}' not found.");
    }

    private static VendorDto MapToDto(Vendor v) => new(
        Id:            v.Id,
        Code:          v.Code,
        Name:          v.Name,
        Gstin:         v.Gstin,
        StateCode:     v.StateCode,
        Address:       v.Address,
        ContactPerson: v.ContactPerson,
        ContactPhone:  v.ContactPhone,
        Email:         v.Email,
        Active:        v.Active,
        IsInterstate:  !string.Equals(v.StateCode, TamilNaduStateCode, StringComparison.Ordinal)
    );
}
