using KovilpattiSnacks.Business.Interface;

namespace KovilpattiSnacks.Business.Implementation;

public class BCryptPasswordHasher : IPasswordHasher
{
    // BCrypt work factor 10 (~200ms per hash on a Railway core). Still recommended
    // by OWASP for password storage (≥10 in 2025); used historically by Auth0.
    // Verify works against ANY workFactor stored in the existing hash — changing
    // this number does not invalidate older hashes, only affects newly created ones.
    public string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, workFactor: 10);

    public bool Verify(string password, string hash) => BCrypt.Net.BCrypt.Verify(password, hash);
}
