using KovilpattiSnacks.Business.DTOs;
using KovilpattiSnacks.Business.DTOs.Products;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]
[Route("api/products")]
public class ProductsController(IProductService products) : ControllerBase
{
    // Filter inputs:
    //   • search       — substring match on name/code
    //   • categoryIds  — comma-separated int list (e.g. "1,3,7"); empty = any
    //   • types        — comma-separated type list (e.g. "pack,jar"); empty = any
    // Single-value legacy callers (?categoryId=2) still work via the alias below.
    [HttpGet]
    public async Task<ActionResult<PagedResult<ProductDto>>> List(
        [FromQuery] string? search,
        [FromQuery] string? categoryIds,
        [FromQuery] string? types,
        [FromQuery(Name = "categoryId")] int? legacyCategoryId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        // 21-Jul-2026: opt-in for the admin product management page to see
        // inactive rows too. Service silently forces false for non-Admin
        // callers — a rogue shop client can't leak inactive products by
        // tampering the URL.
        [FromQuery] bool includeInactive = false,
        CancellationToken ct = default)
    {
        var cats = ParseIntCsv(categoryIds);
        if (cats is null && legacyCategoryId.HasValue) cats = new[] { legacyCategoryId.Value };

        var typeArr = ParseStringCsv(types);
        return Ok(await products.ListAsync(search, cats, typeArr, page, pageSize, includeInactive, ct));
    }

    private static int[]? ParseIntCsv(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var result = new List<int>(parts.Length);
        foreach (var p in parts)
            if (int.TryParse(p, out var n)) result.Add(n);
        return result.Count == 0 ? null : result.ToArray();
    }

    private static string[]? ParseStringCsv(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? null : parts;
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProductDto>> Get(Guid id, CancellationToken ct)
        => Ok(await products.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ProductDto>> Create([FromBody] CreateProductRequest request, CancellationToken ct)
    {
        var dto = await products.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ProductDto>> Update(Guid id, [FromBody] UpdateProductRequest request, CancellationToken ct)
        => Ok(await products.UpdateAsync(id, request, ct));

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await products.DeleteAsync(id, ct);
        return NoContent();
    }

    [HttpPost("import")]
    [Authorize(Roles = "Admin")]
    [RequestSizeLimit(5_000_000)] // 5 MB cap on the import file
    public async Task<ActionResult<ImportProductsResult>> Import(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "Upload a non-empty .xlsx or .csv file." });

        await using var stream = file.OpenReadStream();
        var result = await products.ImportAsync(stream, file.FileName, ct);
        return Ok(result);
    }
}
