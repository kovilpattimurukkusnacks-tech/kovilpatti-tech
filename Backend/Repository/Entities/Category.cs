namespace KovilpattiSnacks.Repository.Entities;

public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = default!;
    public bool Active { get; set; }
}
