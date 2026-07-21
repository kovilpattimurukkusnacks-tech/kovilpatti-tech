namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

public record StaffSalaryRowDto(
    Guid    StaffId,
    string  FullName,
    string  Role,
    Guid?   ShopId,
    string? ShopName,
    Guid?   InventoryId,
    string? InventoryName,
    decimal MonthlyAmount,
    decimal Paid,
    decimal Deducted,
    decimal Net,
    bool    InAccounts);
