namespace KovilpattiSnacks.Business.DTOs.StaffSalaries;

public record SetStaffSalaryRequest(
    Guid     StaffId,
    decimal  MonthlyAmount,
    DateOnly EffectiveFrom);
