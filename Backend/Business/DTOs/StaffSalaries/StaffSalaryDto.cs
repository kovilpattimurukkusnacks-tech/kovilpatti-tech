namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

public record StaffSalaryDto(
    Guid     StaffId,
    decimal  MonthlyAmount,
    DateOnly EffectiveFrom);
