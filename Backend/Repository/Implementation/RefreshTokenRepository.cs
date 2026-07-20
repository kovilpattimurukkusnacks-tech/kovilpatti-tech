using Dapper;
using KovilpattiSnacks.Repository.Data;
using KovilpattiSnacks.Repository.Entities;
using KovilpattiSnacks.Repository.Interface;

namespace KovilpattiSnacks.Repository.Implementation;

public class RefreshTokenRepository(IDbConnectionFactory factory) : IRefreshTokenRepository
{
    public async Task<Guid> IssueAsync(Guid userId, string tokenHash, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_refresh_token_issue(@p_user_id, @p_token_hash, @p_expires_at)";
        return await conn.ExecuteScalarAsync<Guid>(new CommandDefinition(
            sql, new { p_user_id = userId, p_token_hash = tokenHash, p_expires_at = expiresAt }, cancellationToken: ct));
    }

    public async Task<User?> RotateAsync(string oldHash, string newHash, DateTimeOffset newExpiresAt, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT * FROM fn_refresh_token_rotate(@p_old_hash, @p_new_hash, @p_new_expires_at)";
        return await conn.QuerySingleOrDefaultAsync<User>(new CommandDefinition(
            sql, new { p_old_hash = oldHash, p_new_hash = newHash, p_new_expires_at = newExpiresAt }, cancellationToken: ct));
    }

    public async Task<bool> RevokeAsync(string tokenHash, CancellationToken ct = default)
    {
        using var conn = await factory.CreateOpenConnectionAsync(ct);
        const string sql = "SELECT fn_refresh_token_revoke(@p_token_hash)";
        return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            sql, new { p_token_hash = tokenHash }, cancellationToken: ct));
    }
}
