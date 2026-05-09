namespace KovilpattiSnacks.Business.Interface;

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}
