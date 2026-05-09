using KovilpattiSnacks.Repository.Entities;

namespace KovilpattiSnacks.Business.Interface;

public interface IJwtTokenGenerator
{
    (string Token, DateTimeOffset ExpiresAt) Generate(User user);
}
