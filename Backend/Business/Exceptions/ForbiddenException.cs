namespace KovilpattiSnacks.Business.Exceptions;

public class ForbiddenException(string message = "Forbidden") : Exception(message);
