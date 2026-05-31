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

        // Parent must exist (or be null for a root) — surface a clean 400
        // before the SP raises its own foreign_key_violation.
        if (request.ParentId.HasValue
            && !await categories.ExistsAsync(request.ParentId.Value, ct))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.ParentId),
                    $"Parent category '{request.ParentId}' not found.")
            });

        // Name uniqueness is scoped per-parent — same name under different
        // parents is fine (e.g. Snacks > Spicy AND Drinks > Spicy).
        if (await categories.ExistsByNameAsync(name, request.ParentId, excludeId: null, ct))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Name),
                    $"Category '{name}' already exists under this parent.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var newId = await categories.CreateAsync(name, request.ParentId, request.Active, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<CategoryDto> UpdateAsync(int id, UpdateCategoryRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await categories.GetAsync(id, ct)
            ?? throw new NotFoundException($"Category '{id}' not found.");

        var name = request.Name.Trim();

        // Same checks as create. Self-as-parent caught BE-side; deeper cycles
        // (A→B→C→A) are caught by the DB trigger on UPDATE.
        if (request.ParentId.HasValue)
        {
            if (request.ParentId.Value == id)
                throw new ValidationException(new[] {
                    new ValidationFailure(nameof(request.ParentId),
                        "A category cannot be its own parent.")
                });

            if (!await categories.ExistsAsync(request.ParentId.Value, ct))
                throw new ValidationException(new[] {
                    new ValidationFailure(nameof(request.ParentId),
                        $"Parent category '{request.ParentId}' not found.")
                });
        }

        if (await categories.ExistsByNameAsync(name, request.ParentId, excludeId: id, ct))
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.Name),
                    $"Category '{name}' already exists under this parent.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        try
        {
            var ok = await categories.UpdateAsync(id, name, request.ParentId, request.Active, userId, ct);
            if (!ok) throw new NotFoundException($"Category '{id}' not found.");
        }
        catch (PostgresException ex) when (ex.MessageText.Contains("Cycle"))
        {
            // The cycle-guard trigger raises a clear message — surface it as a
            // 400 instead of a 500 so the FE can render it next to the field.
            throw new ValidationException(new[] {
                new ValidationFailure(nameof(request.ParentId), ex.MessageText)
            });
        }

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

    private static CategoryDto MapToDto(Category c)
        => new(c.Id, c.Name, c.Parent_Id, c.Path, c.Depth, c.Active);
}
