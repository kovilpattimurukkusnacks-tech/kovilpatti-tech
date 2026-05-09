using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs.Inventories;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class InventoryService(
    IInventoryRepository inventories,
    ICurrentUser currentUser,
    IValidator<CreateInventoryRequest> createValidator,
    IValidator<UpdateInventoryRequest> updateValidator
) : IInventoryService
{
    public async Task<IReadOnlyList<InventoryDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await inventories.ListAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<InventoryDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var i = await inventories.GetAsync(id, ct)
            ?? throw new NotFoundException($"Inventory '{id}' not found.");
        return MapToDto(i);
    }

    public async Task<InventoryDto> CreateAsync(CreateInventoryRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var code = string.IsNullOrWhiteSpace(request.Code)
            ? await inventories.NextCodeAsync(ct)
            : request.Code.Trim();

        if (await inventories.ExistsByCodeAsync(code, ct))
            throw new ValidationException(new[]
            {
                new ValidationFailure(nameof(request.Code), $"Code '{code}' already exists.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var inv = new Inventory
        {
            Code              = code,
            Name              = request.Name.Trim(),
            Address           = request.Address.Trim(),
            ContactPhone      = request.ContactPhone.Trim(),
            ContactPersonName = string.IsNullOrWhiteSpace(request.ContactPersonName) ? null : request.ContactPersonName.Trim(),
            Active            = request.Active
        };

        var newId = await inventories.CreateAsync(inv, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<InventoryDto> UpdateAsync(Guid id, UpdateInventoryRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await inventories.GetAsync(id, ct)
            ?? throw new NotFoundException($"Inventory '{id}' not found.");

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Inventory
        {
            Id                = id,
            Code              = existing.Code,
            Name              = request.Name.Trim(),
            Address           = request.Address.Trim(),
            ContactPhone      = request.ContactPhone.Trim(),
            ContactPersonName = string.IsNullOrWhiteSpace(request.ContactPersonName) ? null : request.ContactPersonName.Trim(),
            Active            = request.Active
        };

        var ok = await inventories.UpdateAsync(updated, userId, ct);
        if (!ok) throw new NotFoundException($"Inventory '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await inventories.SoftDeleteAsync(id, userId, ct);
        if (!ok) throw new NotFoundException($"Inventory '{id}' not found.");
    }

    private static InventoryDto MapToDto(Inventory i) => new(
        Id:                i.Id,
        Code:              i.Code,
        Name:              i.Name,
        Address:           i.Address,
        ContactPhone:      i.ContactPhone,
        ContactPersonName: i.ContactPersonName,
        Active:            i.Active
    );
}
