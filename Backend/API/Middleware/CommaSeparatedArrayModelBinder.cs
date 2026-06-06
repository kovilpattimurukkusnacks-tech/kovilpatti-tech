using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace KovilpattiSnacks.API.Middleware;

/// <summary>
/// Model binder for comma-separated arrays in the query string.
///
/// ASP.NET Core's default binder for `Guid[]?` / `int[]?` expects repeated
/// keys (?shopIds=a&shopIds=b). The Accounts API contract uses comma-
/// separated values (?shopIds=a,b) per the OpenSpec proposal — this binder
/// makes that work. Falls back to the default behaviour when the value
/// arrives as multiple distinct query-string entries.
///
/// Currently registered globally in Program.cs for Guid[], Guid?[], int[],
/// and int?[]. Empty / missing values yield NULL (matches the SP's "no
/// filter" semantics).
/// </summary>
public class CommaSeparatedArrayModelBinder : IModelBinder
{
    public Task BindModelAsync(ModelBindingContext bindingContext)
    {
        ArgumentNullException.ThrowIfNull(bindingContext);

        var valueProviderResult = bindingContext.ValueProvider.GetValue(bindingContext.ModelName);
        if (valueProviderResult == ValueProviderResult.None)
        {
            return Task.CompletedTask;
        }

        // Join in case the value arrived in multiple entries — supports both
        // ?ids=a,b and ?ids=a&ids=b transparently.
        var raw = string.Join(',', valueProviderResult.Values.ToArray());
        if (string.IsNullOrWhiteSpace(raw))
        {
            bindingContext.Result = ModelBindingResult.Success(null);
            return Task.CompletedTask;
        }

        var elementType = bindingContext.ModelType.GetElementType()
            ?? throw new InvalidOperationException("CommaSeparatedArrayModelBinder applied to a non-array type.");

        var pieces = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (elementType == typeof(Guid))
        {
            var arr = new Guid[pieces.Length];
            for (int i = 0; i < pieces.Length; i++)
            {
                if (!Guid.TryParse(pieces[i], out arr[i]))
                {
                    bindingContext.ModelState.TryAddModelError(bindingContext.ModelName,
                        $"'{pieces[i]}' is not a valid GUID.");
                    return Task.CompletedTask;
                }
            }
            bindingContext.Result = ModelBindingResult.Success(arr);
            return Task.CompletedTask;
        }

        if (elementType == typeof(int))
        {
            var arr = new int[pieces.Length];
            for (int i = 0; i < pieces.Length; i++)
            {
                if (!int.TryParse(pieces[i], out arr[i]))
                {
                    bindingContext.ModelState.TryAddModelError(bindingContext.ModelName,
                        $"'{pieces[i]}' is not a valid integer.");
                    return Task.CompletedTask;
                }
            }
            bindingContext.Result = ModelBindingResult.Success(arr);
            return Task.CompletedTask;
        }

        // Unsupported element type — let the default binder try.
        return Task.CompletedTask;
    }
}

/// <summary>
/// Binder provider that wires <see cref="CommaSeparatedArrayModelBinder"/>
/// for `Guid[]` and `int[]` (including nullable variants when bound to a
/// property typed as the non-nullable array, which is the common case).
/// Other array types fall through to the framework's default behaviour.
/// </summary>
public class CommaSeparatedArrayModelBinderProvider : IModelBinderProvider
{
    public IModelBinder? GetBinder(ModelBinderProviderContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var type = context.Metadata.ModelType;
        if (type.IsArray && (type.GetElementType() == typeof(Guid) || type.GetElementType() == typeof(int)))
        {
            return new CommaSeparatedArrayModelBinder();
        }
        return null;
    }
}
