using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs.Shops;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class ShopService(
    IShopRepository shops,
    IInventoryRepository inventories,
    ICurrentUser currentUser,
    IValidator<CreateShopRequest> createValidator,
    IValidator<UpdateShopRequest> updateValidator
) : IShopService
{
    public async Task<IReadOnlyList<ShopDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await shops.ListAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<ShopDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var s = await shops.GetAsync(id, ct)
            ?? throw new NotFoundException($"Shop '{id}' not found.");
        return MapToDto(s);
    }

    public async Task<ShopDto> CreateAsync(CreateShopRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        if (!await inventories.ExistsAsync(request.InventoryId, ct))
            throw new NotFoundException($"Inventory '{request.InventoryId}' not found.");

        var code = string.IsNullOrWhiteSpace(request.Code)
            ? await shops.NextCodeAsync(ct)
            : request.Code.Trim();

        if (await shops.ExistsByCodeAsync(code, ct))
            throw new ValidationException(new[]
            {
                new ValidationFailure(nameof(request.Code), $"Code '{code}' already exists.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var shop = new Shop
        {
            Code           = code,
            Name           = request.Name.Trim(),
            Address        = request.Address.Trim(),
            ContactPhone1  = request.ContactPhone1.Trim(),
            ContactPhone2  = string.IsNullOrWhiteSpace(request.ContactPhone2) ? null : request.ContactPhone2.Trim(),
            Gstin          = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant(),
            InventoryId    = request.InventoryId,
            Active         = request.Active
        };

        var newId = await shops.CreateAsync(shop, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<ShopDto> UpdateAsync(Guid id, UpdateShopRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await shops.GetAsync(id, ct)
            ?? throw new NotFoundException($"Shop '{id}' not found.");

        if (existing.InventoryId != request.InventoryId &&
            !await inventories.ExistsAsync(request.InventoryId, ct))
            throw new NotFoundException($"Inventory '{request.InventoryId}' not found.");

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Shop
        {
            Id             = id,
            Code           = existing.Code,
            Name           = request.Name.Trim(),
            Address        = request.Address.Trim(),
            ContactPhone1  = request.ContactPhone1.Trim(),
            ContactPhone2  = string.IsNullOrWhiteSpace(request.ContactPhone2) ? null : request.ContactPhone2.Trim(),
            Gstin          = string.IsNullOrWhiteSpace(request.Gstin) ? null : request.Gstin.Trim().ToUpperInvariant(),
            InventoryId    = request.InventoryId,
            Active         = request.Active
        };

        var ok = await shops.UpdateAsync(updated, userId, ct);
        if (!ok) throw new NotFoundException($"Shop '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await shops.SoftDeleteAsync(id, userId, ct);
        if (!ok) throw new NotFoundException($"Shop '{id}' not found.");
    }

    private static ShopDto MapToDto(Shop s) => new(
        Id:             s.Id,
        Code:           s.Code,
        Name:           s.Name,
        Address:        s.Address,
        ContactPhone1:  s.ContactPhone1,
        ContactPhone2:  s.ContactPhone2,
        Gstin:          s.Gstin,
        InventoryId:    s.InventoryId,
        InventoryName:  s.InventoryName,
        Active:         s.Active
    );
}
