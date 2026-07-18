namespace KovilpattiSnacks.Repository.Entities;

public class StaffSalary
{
    public Guid     Staff_Id       { get; set; }
    public decimal  Monthly_Amount { get; set; }
    public DateOnly Effective_From { get; set; }
    public DateTimeOffset Created_At { get; set; }
    public DateTimeOffset Updated_At { get; set; }
}
