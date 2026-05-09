namespace KovilpattiSnacks.Business.Exceptions;

public class UnauthorizedException(string message = "Unauthorized") : Exception(message);
