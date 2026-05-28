using FluentValidation;
using FluentValidation.Results;
using KovilpattiSnacks.Business.Constants;
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
    public async Task<PagedResult<ProductDto>> ListAsync(
        string? search, int[]? categoryIds, string[]? types, int page, int pageSize, CancellationToken ct = default)
    {
        // Defensive clamp — controller already defaults, but a 0 page or pageSize would break LIMIT/OFFSET.
        var safePage     = page     < 1   ? 1   : page;
        var safePageSize = pageSize < 1   ? 10  : (pageSize > 200 ? 200 : pageSize);

        // Normalize empty arrays → null so the SP treats them as "no filter"
        // (saves a needless cardinality check inside the SP).
        var cats  = categoryIds is { Length: > 0 } ? categoryIds : null;
        var typs  = types       is { Length: > 0 } ? types       : null;

        var (rows, total) = await products.ListPagedAsync(search, cats, typs, safePage, safePageSize, ct);
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

        var name        = request.Name.Trim();
        var type        = request.Type.Trim();
        var weightUnit  = (request.WeightUnit ?? "g").Trim().ToLowerInvariant();

        // Variant tuple uniqueness (name + category + type + weight) was
        // removed per client #8 (28-May-2026). Admin can now create rows
        // that look identical on those fields; the global UNIQUE on code
        // still guarantees the SKU code is distinct.

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var product = new Product
        {
            Code           = code,
            Name           = name,
            CategoryId     = request.CategoryId,
            Type           = type,
            WeightValue    = request.WeightValue,
            WeightUnit     = weightUnit,
            Mrp            = request.Mrp,
            PurchasePrice  = request.PurchasePrice,
            Gst            = request.Gst,
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

        var name        = request.Name.Trim();
        var type        = request.Type.Trim();
        var weightUnit  = (request.WeightUnit ?? "g").Trim().ToLowerInvariant();

        // Variant tuple uniqueness dropped per client #8 (28-May-2026) —
        // see CreateAsync for the rationale.

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Product
        {
            Id             = id,
            Code           = existing.Code,
            Name           = name,
            CategoryId     = request.CategoryId,
            Type           = type,
            WeightValue    = request.WeightValue,
            WeightUnit     = weightUnit,
            Mrp            = request.Mrp,
            PurchasePrice  = request.PurchasePrice,
            // FE form doesn't expose GST yet — if the request omits it, keep
            // whatever was persisted so the update doesn't wipe the value.
            Gst            = request.Gst ?? existing.Gst,
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
    // inserted. Variant-tuple dedup (both cross-DB and same-file) was removed
    // per client #8 (28-May-2026): identical-looking rows are allowed, and
    // importing the same row twice creates two products. For unknown
    // categories we surface a "did you mean" hint based on Levenshtein
    // distance — never auto-mapped.
    //
    // Atomicity: validated rows are inserted via fn_product_create_bulk in a
    // SINGLE SP call. The SP runs in one transaction — any insert failure
    // rolls back the whole batch (no partial commits).
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

        var allCategories  = await categories.ListAsync(ct);
        var categoryByName = allCategories.ToDictionary(c => c.Name.Trim(), c => c, StringComparer.OrdinalIgnoreCase);

        // Variant-key dedup (both cross-DB and same-file) was removed per
        // client #8. `skipped` is still tracked because the result type
        // expects the list; today it's only populated for things like
        // unknown-but-suggested categories (errors path).

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

            var rowName = row.Name!.Trim();
            var rowType = row.Type!.Trim();

            // Variant dedup removed (client #8). Same row repeated in the
            // file => two products; same variant already in DB => another
            // product alongside the existing one. Code is still globally
            // unique (server-assigned by the bulk SP).

            validated.Add(new Product
            {
                Name           = rowName,
                CategoryId     = category!.Id,
                Type           = rowType,
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

        // Single SP call inserts every validated row atomically, generating
        // codes server-side. Replaces N × NextCode + N × Create round-trips.
        var inserted = await products.CreateBulkAsync(validated, userId, ct);

        return new ImportProductsResult(rawRows.Count, inserted.Count, skipped, []);
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
        // Scale the threshold with category-name length — distance 3 is a fair
        // tolerance for "Beverages" but absurd for "Tea". Cap at 3 either way
        // so we never offer wildly wrong suggestions.
        var normalized = typo.Trim().ToLowerInvariant();
        var best = all
            .Select(c => (c.Name, Distance: Levenshtein(normalized, c.Name.Trim().ToLowerInvariant())))
            .OrderBy(x => x.Distance)
            .FirstOrDefault();
        if (best.Name is null) return null;

        var threshold = Math.Min(3, Math.Max(1, best.Name.Length / 2));
        return best.Distance <= threshold ? best.Name : null;
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
        var hidePurchase = string.Equals(currentUser.Role, RoleNames.ShopUser, StringComparison.OrdinalIgnoreCase);
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
            Gst:           p.Gst,
            Active:        p.Active
        );
    }
}
