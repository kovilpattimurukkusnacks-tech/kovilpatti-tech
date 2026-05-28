namespace KovilpattiSnacks.Business.DTOs.Categories;

/// <summary>
/// Create a new category. <see cref="ParentId"/> is optional — omit for a
/// root category, supply for a sub-category. The DB enforces parent-must-
/// exist + no-cycle on insert; the BE validator surfaces the same rules
/// with friendlier messages before the SP is called.
/// </summary>
public record CreateCategoryRequest(string Name, int? ParentId, bool Active = true);
