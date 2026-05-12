using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs.Categories;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using Npgsql;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class CategoryService(
    ICategoryRepository categories,
    ICurrentUser currentUser,
    IValidator<CreateCategoryRequest> createValidator,
    IValidator<UpdateCategoryRequest> updateValidator
) : ICategoryService
{
    public async Task<IReadOnlyList<CategoryDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await categories.ListAsync(ct);
        return rows.Select(MapToDto).ToList();
    }

    public async Task<CategoryDto> GetAsync(int id, CancellationToken ct = default)
    {
        var c = await categories.GetAsync(id, ct)
            ?? throw new NotFoundException($"Category '{id}' not found.");
        return MapToDto(c);
    }

    public async Task<CategoryDto> CreateAsync(CreateCategoryRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var name = request.Name.Trim();

        if (await categories.ExistsByNameAsync(name, excludeId: null, ct))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Name), $"Category '{name}' already exists.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var newId = await categories.CreateAsync(name, request.Active, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<CategoryDto> UpdateAsync(int id, UpdateCategoryRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await categories.GetAsync(id, ct)
            ?? throw new NotFoundException($"Category '{id}' not found.");

        var name = request.Name.Trim();

        if (await categories.ExistsByNameAsync(name, excludeId: id, ct))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Name), $"Category '{name}' already exists.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await categories.UpdateAsync(id, name, request.Active, userId, ct);
        if (!ok) throw new NotFoundException($"Category '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(int id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        try
        {
            var ok = await categories.SoftDeleteAsync(id, userId, ct);
            if (!ok) throw new NotFoundException($"Category '{id}' not found.");
        }
        catch (PostgresException ex) when (ex.SqlState == "23503")
        {
            // fn_category_soft_delete raises this when products still reference
            // the category. Surface as a 400 with the SP-provided message.
            throw new ValidationException(new[] {
                new ValidationFailure("id", ex.MessageText)
            });
        }
    }

    private static CategoryDto MapToDto(Category c) => new(c.Id, c.Name, c.Active);
}
