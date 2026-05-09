# syntax=docker/dockerfile:1
# ============================================================
# Kovilpatti Snacks API — multi-stage .NET 9 build
# Build context: the `Backend/` folder (set on Railway as Root Directory).
# ============================================================

# ── Stage 1: build & publish ────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy csproj files first to leverage Docker layer caching for `restore`.
COPY API/KovilpattiSnacks.API.csproj                 API/
COPY Business/KovilpattiSnacks.Business.csproj       Business/
COPY Repository/KovilpattiSnacks.Repository.csproj   Repository/
COPY KovilpattiSnacks.sln                            ./
RUN dotnet restore API/KovilpattiSnacks.API.csproj

# Copy the rest of the source and publish.
COPY . .
RUN dotnet publish API/KovilpattiSnacks.API.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# ── Stage 2: runtime ────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Railway injects PORT; ASPNETCORE_URLS env var (set in Railway Variables)
# binds Kestrel to http://+:${PORT}. EXPOSE here is a hint, not a constraint.
EXPOSE 8080

ENTRYPOINT ["dotnet", "KovilpattiSnacks.API.dll"]
