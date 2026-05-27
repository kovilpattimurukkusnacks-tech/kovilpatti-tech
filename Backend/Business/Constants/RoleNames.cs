namespace KovilpattiSnacks.Business.Constants;

/// <summary>
/// Single source of truth for role names. The Role column on the `users`
/// table holds the same literal strings; controller [Authorize] attributes
/// reference these via compile-time const concat.
///
/// Adding a role: add a const here, update any [Authorize(Roles = ...)] that
/// should accept it, and update the DB enum if the role is persisted there.
/// </summary>
public static class RoleNames
{
    public const string ShopUser  = "ShopUser";
    public const string Inventory = "Inventory";
    public const string Admin     = "Admin";
}
