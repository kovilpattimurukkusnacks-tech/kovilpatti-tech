namespace KovilpattiSnacks.Business.Interface;

public interface ICurrentUser
{
    Guid? UserId { get; }
    string? Role { get; }
    bool IsAuthenticated { get; }
}
