namespace KovilpattiSnacks.Business.Exceptions;

/// <summary>
/// Thrown when a caller exceeds a rate-limit budget (e.g., too many failed
/// login attempts within the window). Maps to HTTP 429 in the API layer.
/// </summary>
public class TooManyRequestsException(string message = "Too many requests.") : Exception(message);
