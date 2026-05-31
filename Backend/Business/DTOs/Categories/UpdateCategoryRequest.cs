namespace KovilpattiSnacks.Business.DTOs.Categories;

/// <summary>
/// Update an existing category. <see cref="ParentId"/> may change between
/// updates — moving a sub-category under a different parent is supported.
/// Setting it to <c>null</c> promotes the row to a root. The DB cycle-guard
/// trigger rejects any change that would make the row a descendant of itself.
/// </summary>
public record UpdateCategoryRequest(string Name, int? ParentId, bool Active);
