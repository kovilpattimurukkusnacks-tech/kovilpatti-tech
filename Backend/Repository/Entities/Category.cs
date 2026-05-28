namespace KovilpattiSnacks.Repository.Entities;

public class Category
{
    public int     Id        { get; set; }
    public string  Name      { get; set; } = default!;
    /// NULL = root category. Self-FK on categories.id.
    public int?    Parent_Id { get; set; }
    /// Breadcrumb (" > "-joined names from root to this node). Populated by
    /// fn_category_list / fn_category_tree / fn_category_get. NULL on bare
    /// queries that don't traverse the tree.
    public string? Path      { get; set; }
    /// 0 for roots, +1 per nesting level. Populated by the same tree SPs.
    public int     Depth     { get; set; }
    public bool    Active    { get; set; }
}
