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
            Code             = code,
            Name             = name,
            CategoryId       = request.CategoryId,
            Type             = type,
            WeightValue      = request.WeightValue,
            WeightUnit       = weightUnit,
            Mrp              = request.Mrp,
            PurchasePrice    = request.PurchasePrice,
            Gst              = request.Gst,
            Active           = request.Active,
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

        // Code is editable as of 07-Jun-2026 (client #10). Treat null/blank
        // as "keep existing"; non-blank as a re-code request. We only run
        // the uniqueness check when the code actually changed — the BE
        // doesn't have an "exists by code excluding id" SP and adding one
        // just to skip this short-circuit would be more code for the same
        // result.
        var code = string.IsNullOrWhiteSpace(request.Code)
            ? existing.Code
            : request.Code.Trim();
        if (code != existing.Code && await products.ExistsByCodeAsync(code, ct))
            throw new ValidationException(new[]
            {
                new ValidationFailure(nameof(request.Code), $"Code '{code}' already exists.")
            });

        var name        = request.Name.Trim();
        var type        = request.Type.Trim();
        var weightUnit  = (request.WeightUnit ?? "g").Trim().ToLowerInvariant();

        // Variant tuple uniqueness dropped per client #8 (28-May-2026) —
        // see CreateAsync for the rationale.

        var userId = currentUser.UserId
            ?? throw new UnauthorizedException("Authenticated user required.");

        var updated = new Product
        {
            Id               = id,
            Code             = code,
            Name             = name,
            CategoryId       = request.CategoryId,
            Type             = type,
            WeightValue      = request.WeightValue,
            WeightUnit       = weightUnit,
            Mrp              = request.Mrp,
            PurchasePrice    = request.PurchasePrice,
            // FE form doesn't expose GST yet — if the request omits it, keep
            // whatever was persisted so the update doesn't wipe the value.
            Gst              = request.Gst ?? existing.Gst,
            Active           = request.Active,
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

        // Code uniqueness check (13-Jun-2026, client #10) — mirrors the
        // editable code feature on Create/Edit. Build a HashSet of existing
        // product codes once so each row is an O(1) lookup instead of an
        // N+1 round-trip. Same-file dup is tracked in a second HashSet that
        // we populate as we iterate.
        var existingProducts = await products.ListAsync(null, null, ct);
        var existingCodes = new HashSet<string>(
            existingProducts.Select(p => p.Code),
            StringComparer.Ordinal);
        var fileCodes = new HashSet<string>(StringComparer.Ordinal);

        // Hard short-circuit: when there are ZERO categories in the system,
        // every row would fail with "category not found" and the admin gets
        // 50 identical error lines telling them nothing actionable. Fail
        // once with a clear, top-level message instead.
        if (allCategories.Count == 0)
        {
            throw new ValidationException(new[]
            {
                new ValidationFailure("file",
                    "No categories exist yet. Create at least one category on the Categories page before importing products. " +
                    "Every product must belong to a category — the import can't auto-create them.")
            });
        }

        // Two lookups so the Excel can write either the bare leaf name (when
        // it's unique system-wide) OR the full breadcrumb path (always
        // unambiguous). Path uses " > " as the separator — same shape the
        // categories tree SP returns on c.Path.
        //
        //   "Snacks > Sweets > 100g"  → unambiguous match via byPath
        //   "100g"                    → matched via byName when only one
        //                               category named "100g" exists; row
        //                               errors with a "use full path" hint
        //                               otherwise.
        var byPath = new Dictionary<string, Category>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in allCategories)
        {
            // Cat.Path is " > "-joined from root. Fall back to bare Name when
            // the SP didn't populate Path (defensive — shouldn't happen post #1).
            var key = NormalizeCategoryPath(c.Path ?? c.Name);
            byPath[key] = c;
        }
        var byName = allCategories
            .ToLookup(c => c.Name.Trim(), StringComparer.OrdinalIgnoreCase);

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
                var rawCat = row.Category!.Trim();
                if (rawCat.Contains('>'))
                {
                    // Path mode — exact match against the normalised " > " path.
                    byPath.TryGetValue(NormalizeCategoryPath(rawCat), out category);
                }
                else
                {
                    // Bare-name mode — succeed only when one category in the
                    // system has this name. When two siblings or branches
                    // share it, force the admin to qualify with the full path.
                    var matches = byName[rawCat].ToList();
                    if (matches.Count == 1)
                    {
                        category = matches[0];
                    }
                    else if (matches.Count > 1)
                    {
                        var pathsHint = string.Join(", ",
                            matches.Select(m => $"\"{m.Path ?? m.Name}\""));
                        rowErrors.Add(
                            $"category \"{rawCat}\" is ambiguous — {matches.Count} categories share this name. " +
                            $"Use the full path instead (one of: {pathsHint}).");
                    }
                }

                if (category is null && rowErrors.Count == 0)
                {
                    // Truly not found — suggest a path or name based on what
                    // the user typed.
                    var suggestion = SuggestCategory(rawCat, allCategories);
                    rowErrors.Add(suggestion is null
                        ? $"category \"{rawCat}\" not found"
                        : $"category \"{rawCat}\" not found — did you mean \"{suggestion}\"?");
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
            if (weightUnit is not ("g" or "kg" or "pcs" or "pkt")) rowErrors.Add("weight_unit must be 'g', 'kg', 'pcs', or 'pkt'");

            var active = ParseActive(row.Active);

            // Code (optional). Blank → SP auto-generates. Non-blank →
            // validate against existing DB codes AND within-file duplicates.
            var rowCode = row.Code?.Trim() ?? string.Empty;
            if (rowCode.Length > 0)
            {
                if (existingCodes.Contains(rowCode))
                    rowErrors.Add($"code \"{rowCode}\" already exists in the catalog");
                else if (!fileCodes.Add(rowCode))
                    rowErrors.Add($"code \"{rowCode}\" is duplicated within this file");
            }

            if (rowErrors.Count > 0)
            {
                errors.Add(new ImportProductError(row.RowNumber, string.Join("; ", rowErrors)));
                continue;
            }

            var rowName = row.Name!.Trim();
            var rowType = row.Type!.Trim();

            // Variant dedup removed (client #8). Same row repeated in the
            // file => two products; same variant already in DB => another
            // product alongside the existing one. Code uniqueness is now
            // checked above when admin provides one explicitly — blank
            // codes still get server-assigned by the bulk SP.

            validated.Add(new Product
            {
                Code           = rowCode,    // empty → SP auto-generates via COALESCE
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
        // When the user typed a path-style value, compare against full paths so
        // a typo like "Snacks > Swets" suggests "Snacks > Sweets". Otherwise
        // compare against bare leaf names.
        var normalized = typo.Trim().ToLowerInvariant();
        var isPath = normalized.Contains('>');

        var best = all
            .Select(c =>
            {
                var candidate = isPath
                    ? NormalizeCategoryPath(c.Path ?? c.Name).ToLowerInvariant()
                    : c.Name.Trim().ToLowerInvariant();
                return (Label: isPath ? (c.Path ?? c.Name) : c.Name,
                        Distance: Levenshtein(
                            isPath ? NormalizeCategoryPath(normalized) : normalized,
                            candidate));
            })
            .OrderBy(x => x.Distance)
            .FirstOrDefault();
        if (best.Label is null) return null;

        // Scale the threshold with the candidate's length — distance 3 is a
        // fair tolerance for "Beverages" but absurd for "Tea". Cap at 4 for
        // paths since they're longer.
        var cap = isPath ? 4 : 3;
        var threshold = Math.Min(cap, Math.Max(1, best.Label.Length / 4));
        return best.Distance <= threshold ? best.Label : null;
    }

    /// Normalise a user-supplied category path into the canonical
    /// " > "-joined form so lookups are insensitive to spacing variations.
    /// Examples:
    ///   "Snacks>Sweets"       → "Snacks > Sweets"
    ///   " Snacks  > Sweets "  → "Snacks > Sweets"
    ///   "Snacks  >  Sweets >" → "Snacks > Sweets"  (drops empty trailing)
    private static string NormalizeCategoryPath(string path)
        => string.Join(" > ",
            path.Split('>', StringSplitOptions.None)
                .Select(s => s.Trim())
                .Where(s => !string.IsNullOrEmpty(s)));

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
            Id:               p.Id,
            Code:             p.Code,
            Name:             p.Name,
            CategoryId:       p.CategoryId,
            CategoryName:     p.CategoryName,
            Type:             p.Type,
            WeightValue:      p.WeightValue,
            WeightUnit:       p.WeightUnit,
            Mrp:              p.Mrp,
            PurchasePrice:    hidePurchase ? null : p.PurchasePrice,
            Gst:              p.Gst,
            Active:           p.Active
        );
    }
}
