using System.Data;
using Dapper;

namespace KovilpattiSnacks.Repository;

/// <summary>
/// This project's Dapper version doesn't know how to bind System.DateOnly as a
/// command parameter (throws "DateOnly cannot be used as a parameter value").
///
/// This handler converts DateOnly → DateTime and tags the parameter as
/// DbType.Date, so Npgsql sends a PostgreSQL `date` — matching the date-typed
/// SP params (e.g. fn_request_list_paged's p_from_date / p_to_date). Without
/// the DbType.Date tag, Npgsql would send a `timestamp` and the SP's `date`
/// param wouldn't resolve.
///
/// Registered once via SqlMapper.AddTypeHandler in AddRepository. Dapper applies
/// it to both DateOnly and DateOnly? automatically (it unwraps the nullable).
/// </summary>
public sealed class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value  = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value)
        => DateOnly.FromDateTime((DateTime)value);
}
