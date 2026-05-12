using KovilpattiSnacks.Business.DTOs.Categories;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

[ApiController]
[Authorize]
[Route("api/categories")]
public class CategoriesController(ICategoryService categories) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<CategoryDto>>> List(CancellationToken ct)
        => Ok(await categories.ListAsync(ct));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<CategoryDto>> Get(int id, CancellationToken ct)
        => Ok(await categories.GetAsync(id, ct));

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<CategoryDto>> Create([FromBody] CreateCategoryRequest request, CancellationToken ct)
    {
        var created = await categories.CreateAsync(request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<CategoryDto>> Update(int id, [FromBody] UpdateCategoryRequest request, CancellationToken ct)
        => Ok(await categories.UpdateAsync(id, request, ct));

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await categories.DeleteAsync(id, ct);
        return NoContent();
    }
}
