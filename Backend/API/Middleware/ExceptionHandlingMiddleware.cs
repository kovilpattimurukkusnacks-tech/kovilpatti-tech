using System.Net;
using System.Text.Json;
using KovilpattiSnacks.Business.Exceptions;

namespace KovilpattiSnacks.API.Middleware;

public class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            await next(ctx);
        }
        catch (ValidationException ex)
        {
            logger.LogWarning(ex, "Validation failed");
            ctx.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await WriteJsonAsync(ctx, new { error = "Validation failed", errors = ex.Errors });
        }
        catch (NotFoundException ex)
        {
            ctx.Response.StatusCode = (int)HttpStatusCode.NotFound;
            await WriteJsonAsync(ctx, new { error = ex.Message });
        }
        catch (UnauthorizedException ex)
        {
            ctx.Response.StatusCode = (int)HttpStatusCode.Unauthorized;
            await WriteJsonAsync(ctx, new { error = ex.Message });
        }
        catch (ForbiddenException ex)
        {
            ctx.Response.StatusCode = (int)HttpStatusCode.Forbidden;
            await WriteJsonAsync(ctx, new { error = ex.Message });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled exception");
            ctx.Response.StatusCode = (int)HttpStatusCode.InternalServerError;
            await WriteJsonAsync(ctx, new { error = "An unexpected error occurred." });
        }
    }

    private static Task WriteJsonAsync(HttpContext ctx, object payload)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(JsonSerializer.Serialize(payload, JsonOpts));
    }
}
