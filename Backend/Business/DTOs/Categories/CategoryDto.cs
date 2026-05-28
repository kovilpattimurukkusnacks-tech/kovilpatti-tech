namespace KovilpattiSnacks.Business.DTOs.Categories;

/// <summary>
/// Category record — supports unlimited nesting via <see cref="ParentId"/>.
/// <see cref="Path"/> is the " > "-joined breadcrumb from root to this node;
/// <see cref="Depth"/> is 0 for roots and +1 per nesting level. Both are
/// populated by the tree SPs and surfaced so the FE can render breadcrumbs
/// without re-traversing the parent chain.
/// </summary>
public record CategoryDto(
    int     Id,
    string  Name,
    int?    ParentId,
    string? Path,
    int     Depth,
    bool    Active);
