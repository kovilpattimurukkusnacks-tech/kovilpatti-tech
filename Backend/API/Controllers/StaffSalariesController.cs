using KovilpattiSnacks.Business.Constants;
using KovilpattiSnacks.Business.DTOs.StaffSalaries;
using KovilpattiSnacks.Business.Interface;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KovilpattiSnacks.API.Controllers;

/// <summary>
/// Staff Salary — backs the "Salary" tab on the Admin Staff screen. Admin
/// only; see StaffSalaryService for how Pay/Deduct entries tie into Accounts.
/// </summary>
[ApiController]
[Authorize(Roles = RoleNames.Admin)]
[Route("api/staff-salaries")]
public class StaffSalariesController(IStaffSalaryService staffSalaries) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<StaffSalaryRowDto>>> List(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
        => Ok(await staffSalaries.ListAsync(from, to, ct));

    [HttpPost("set")]
    public async Task<ActionResult<StaffSalaryDto>> Set([FromBody] SetStaffSalaryRequest request, CancellationToken ct)
        => Ok(await staffSalaries.SetSalaryAsync(request, ct));

    [HttpPost("pay")]
    public async Task<IActionResult> Pay([FromBody] PaySalaryRequest request, CancellationToken ct)
    {
        await staffSalaries.PayAsync(request, ct);
        return NoContent();
    }

    [HttpPost("deduct")]
    public async Task<IActionResult> Deduct([FromBody] DeductSalaryRequest request, CancellationToken ct)
    {
        await staffSalaries.DeductAsync(request, ct);
        return NoContent();
    }

    /// <summary>
    /// Signed, dated Pay/Deduct history for one staff member — powers the
    /// "hover the Net figure" breakdown on the Salary tab.
    /// </summary>
    [HttpGet("{staffId:guid}/transactions")]
    public async Task<ActionResult<IReadOnlyList<StaffSalaryTransactionDto>>> Transactions(
        Guid staffId, [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
        => Ok(await staffSalaries.GetTransactionsAsync(staffId, from, to, ct));
}
