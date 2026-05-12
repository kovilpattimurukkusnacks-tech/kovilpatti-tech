using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Products;
using KovilpattiSnacks.Business.Exceptions;
using KovilpattiSnacks.Business.Interface;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;
using ValidationException = KovilpattiSnacks.Business.Exceptions.ValidationException;

namespace KovilpattiSnacks.Business.Implementation;

public class ProductService(
    IProductRepository products,
    ICategoryRepository categories,
    ICurrentUser currentUser,
    IValidator<CreateProductRequest> createValidator,
    IValidator<UpdateProductRequest> updateValidator
) : IProductService
{
    public async Task<PagedResult<ProductDto>> ListAsync(string? search, int? categoryId, int page, int pageSize, CancellationToken ct = default)
    {
        // Defensive clamp — controller already defaults, but a 0 page or pageSize would break LIMIT/OFFSET.
        var safePage     = page     < 1   ? 1   : page;
        var safePageSize = pageSize < 1   ? 10  : (pageSize > 200 ? 200 : pageSize);

        var (rows, total) = await products.ListPagedAsync(search, categoryId, safePage, safePageSize, ct);
        var items = rows.Select(MapToDto).ToList();
        return new PagedResult<ProductDto>(items, total, safePage, safePageSize);
    }

    public async Task<ProductDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var p = await products.GetAsync(id, ct)
            ?? throw new NotFoundException($"Product '{id}' not found.");
        return MapToDto(p);
    }

    public async Task<ProductDto> CreateAsync(CreateProductRequest request, CancellationToken ct = default)
    {
        var validation = await createValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        if (!await categories.ExistsAsync(request.CategoryId, ct))
            throw new NotFoundException($"Category '{request.CategoryId}' not found.");

        var code = string.IsNullOrWhiteSpace(request.Code)
            ? await products.NextCodeAsync(ct)
            : request.Code.Trim();

        if (await products.ExistsByCodeAsync(code, ct))
            throw new ValidationException(new[]
            {
                new ValidationFailure(nameof(request.Code), $"Code '{code}' already exists.")
            });

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var product = new Product
        {
            Code           = code,
            Name           = request.Name.Trim(),
            CategoryId     = request.CategoryId,
            Type           = request.Type.Trim(),
            WeightValue    = request.WeightValue,
            WeightUnit     = request.WeightUnit ?? "g",
            Mrp            = request.Mrp,
            PurchasePrice  = request.PurchasePrice,
            Active         = request.Active
        };

        var newId = await products.CreateAsync(product, userId, ct);
        return await GetAsync(newId, ct);
    }

    public async Task<ProductDto> UpdateAsync(Guid id, UpdateProductRequest request, CancellationToken ct = default)
    {
        var validation = await updateValidator.ValidateAsync(request, ct);
        if (!validation.IsValid) throw new ValidationException(validation.Errors);

        var existing = await products.GetAsync(id, ct)
            ?? throw new NotFoundException($"Product '{id}' not found.");

        if (existing.CategoryId != request.CategoryId &&
            !await categories.ExistsAsync(request.CategoryId, ct))
            throw new NotFoundException($"Category '{request.CategoryId}' not found.");

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Product
        {
            Id             = id,
            Code           = existing.Code,
            Name           = request.Name.Trim(),
            CategoryId     = request.CategoryId,
            Type           = request.Type.Trim(),
            WeightValue    = request.WeightValue,
            WeightUnit     = request.WeightUnit ?? "g",
            Mrp            = request.Mrp,
            PurchasePrice  = request.PurchasePrice,
            Active         = request.Active
        };

        var ok = await products.UpdateAsync(updated, userId, ct);
        if (!ok) throw new NotFoundException($"Product '{id}' not found.");

        return await GetAsync(id, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var ok = await products.SoftDeleteAsync(id, userId, ct);
        if (!ok) throw new NotFoundException($"Product '{id}' not found.");
    }

    // Bulk import — strict validation; if any row has a hard error, nothing is
    // inserted. Rows whose `name` already exists are silently skipped (returned
    // in the result, not treated as errors). For unknown categories we surface
    // a "did you mean" hint based on Levenshtein distance — never auto-mapped.
    public async Task<ImportProductsResult> ImportAsync(Stream fileStream, string fileName, CancellationToken ct = default)
    {
        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        List<ProductImportParser.RawRow> rawRows;
        try { rawRows = ProductImportParser.Parse(fileStream, fileName); }
        catch (Exception ex)
        {
            throw new ValidationException(new[] { new ValidationFailure("file", ex.Message) });
        }

        if (rawRows.Count == 0)
            return new ImportProductsResult(0, 0, [], []);

        var allCategories = await categories.ListAsync(ct);
        var categoryByName = allCategories.ToDictionary(c => c.Name.Trim(), c => c, StringComparer.OrdinalIgnoreCase);
        var existingNames = (await products.ListAsync(null, null, ct))
            .Select(p => p.Name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var errors = new List<ImportProductError>();
        var skipped = new List<ImportProductSkipped>();
        var validated = new List<Product>();

        foreach (var row in rawRows)
        {
            var rowErrors = new List<string>();

            if (string.IsNullOrWhiteSpace(row.Name))
                rowErrors.Add("name is required");
            if (string.IsNullOrWhiteSpace(row.Category))
                rowErrors.Add("category is required");
            if (string.IsNullOrWhiteSpace(row.Type))
                rowErrors.Add("type is required");

            Category? category = null;
            if (!string.IsNullOrWhiteSpace(row.Category))
            {
                if (!categoryByName.TryGetValue(row.Category.Trim(), out category))
                {
                    var suggestion = SuggestCategory(row.Category!, allCategories);
                    rowErrors.Add(suggestion is null
                        ? $"category \"{row.Category}\" not found"
                        : $"category \"{row.Category}\" not found — did you mean \"{suggestion}\"?");
                }
            }

            if (!TryParseDecimal(row.Mrp, out var mrp) || mrp < 0)
                rowErrors.Add("mrp must be a non-negative number");
            if (!TryParseDecimal(row.PurchasePrice, out var pp) || pp < 0)
                rowErrors.Add("purchase_price must be a non-negative number");

            decimal? weightValue = null;
            if (!string.IsNullOrWhiteSpace(row.WeightValue))
            {
                if (!TryParseDecimal(row.WeightValue, out var w) || w <= 0)
                    rowErrors.Add("weight_value must be a positive number when provided");
                else weightValue = w;
            }

            var weightUnit = (row.WeightUnit ?? "g").Trim().ToLowerInvariant();
            if (weightUnit is not ("g" or "kg")) rowErrors.Add("weight_unit must be 'g' or 'kg'");

            var active = ParseActive(row.Active);

            if (rowErrors.Count > 0)
            {
                errors.Add(new ImportProductError(row.RowNumber, string.Join("; ", rowErrors)));
                continue;
            }

            // Hard errors check passed — now soft-skip duplicates.
            if (existingNames.Contains(row.Name!.Trim()))
            {
                skipped.Add(new ImportProductSkipped(row.RowNumber, row.Name!.Trim(), "name already exists"));
                continue;
            }

            validated.Add(new Product
            {
                Name           = row.Name!.Trim(),
                CategoryId     = category!.Id,
                Type           = row.Type!.Trim(),
                WeightValue    = weightValue,
                WeightUnit     = weightUnit,
                Mrp            = mrp,
                PurchasePrice  = pp,
                Active         = active,
            });
        }

        // Hard errors? Bail without inserting anything (all-or-nothing).
        if (errors.Count > 0)
            return new ImportProductsResult(rawRows.Count, 0, [], errors);

        var imported = 0;
        foreach (var p in validated)
        {
            p.Code = await products.NextCodeAsync(ct);
            await products.CreateAsync(p, userId, ct);
            imported++;
        }

        return new ImportProductsResult(rawRows.Count, imported, skipped, []);
    }

    private static bool TryParseDecimal(string? raw, out decimal value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(raw)) return false;
        return decimal.TryParse(raw.Trim(), System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out value);
    }

    private static bool ParseActive(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return true;
        var v = raw.Trim().ToLowerInvariant();
        return v is "yes" or "y" or "true" or "1" or "active";
    }

    private static string? SuggestCategory(string typo, IReadOnlyList<Category> all)
    {
        // Suggest only if the closest existing category is reasonably near (<= 3 edits).
        var best = all
            .Select(c => (c.Name, Distance: Levenshtein(typo.Trim().ToLowerInvariant(), c.Name.Trim().ToLowerInvariant())))
            .OrderBy(x => x.Distance)
            .FirstOrDefault();
        return best.Distance <= 3 ? best.Name : null;
    }

    private static int Levenshtein(string a, string b)
    {
        if (a.Length == 0) return b.Length;
        if (b.Length == 0) return a.Length;
        var prev = new int[b.Length + 1];
        var curr = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) prev[j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            curr[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                curr[j] = Math.Min(Math.Min(curr[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            (prev, curr) = (curr, prev);
        }
        return prev[b.Length];
    }

    private ProductDto MapToDto(Product p)
    {
        var hidePurchase = string.Equals(currentUser.Role, "ShopUser", StringComparison.OrdinalIgnoreCase);
        return new ProductDto(
            Id:            p.Id,
            Code:          p.Code,
            Name:          p.Name,
            CategoryId:    p.CategoryId,
            CategoryName:  p.CategoryName,
            Type:          p.Type,
            WeightValue:   p.WeightValue,
            WeightUnit:    p.WeightUnit,
            Mrp:           p.Mrp,
            PurchasePrice: hidePurchase ? null : p.PurchasePrice,
            Active:        p.Active
        );
    }
}
