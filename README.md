# Kovilpatti Snacks — Shop-to-Godown Inventory Management

Full-stack Phase 1 app for **SK's Murukku & Snacks Kadai** — React frontend talking to a .NET 9 Web API backed by PostgreSQL stored functions.

## Tech stack

**Backend** (`Backend/`)
- **.NET 9** Web API in a 3-tier layout — `API → Business → Repository`
- **Dapper** + raw SQL stored functions (no ORM)
- **JWT bearer** auth + **BCrypt** password hashing
- **FluentValidation** for request validation
- **Swashbuckle** for Swagger UI
- Health check via `/health` (anonymous, pings DB)

**Database** (`DB/`)
- **PostgreSQL 13+** / **Supabase**
- All read/write logic lives in `CREATE FUNCTION` SPs — the .NET code is a thin Dapper caller
- Audit columns (`created_by`, `updated_by`, `created_at`, `updated_at`) on every table
- `is_deleted` soft-delete flag separate from `active` business flag

**Frontend** (`front-end/`)
- **React 19 + TypeScript + Vite 8**
- **MUI v9** (incl. `@mui/x-data-grid`) + **Tailwind CSS v4** for styling
- **React Router v7**
- **@tanstack/react-query** for server-state (cache, mutations, auto-refetch)
- **lucide-react** icons

## Layout

```
Kovilpatti snacks Inventory/
├── README.md
├── .gitignore
│
├── DB/                                  Postgres schema + stored functions
│   ├── phase1_init.sql                  Schema — 5 tables, audit columns, user_role enum, is_deleted flags
│   ├── phase1_procedures.sql            All stored functions (auth + CRUD for every entity + categories)
│   └── migration_add_is_deleted.sql     One-shot migration for older DBs that pre-date is_deleted
│
├── Backend/                             .NET 9 solution
│   ├── KovilpattiSnacks.sln
│   ├── API/                             Controllers, middleware, Program.cs, appsettings.{Env}.json
│   ├── Business/                        Services, DTOs, validators, JWT, BCrypt (Interface/Implementation split)
│   └── Repository/                      Entities, NpgsqlDataSource factory, Dapper repos calling SPs
│
└── front-end/                           Vite + React app
    ├── package.json
    ├── .env.local                       VITE_API_URL — gitignored
    └── src/
        ├── main.tsx                     Wires QueryClientProvider + ThemeProvider
        ├── App.tsx                      Routes
        ├── api/                         Pure HTTP layer — one folder per resource (auth, products, …)
        │   ├── client.ts                fetch wrapper — JWT header, 401 handling, error mapping
        │   ├── tokenStore.ts            JWT in localStorage + UNAUTHORIZED_EVENT
        │   └── <resource>/{types,api}.ts
        ├── hooks/                       React Query hooks — one file per resource
        ├── pages/                       Landing, AdminLogin, Products, Inventories, Shops, Staff
        ├── components/                  Layout, Sidebar, PageHeader, StatCard, ConfirmDialog
        └── styles/global.css            Shared utility classes for the data-page pattern
```

## Prerequisites

- **.NET 9 SDK** (`dotnet --version` ≥ 9.0)
- **Node.js 20+** and **npm**
- **PostgreSQL 13+** (or a Supabase project)

## First-time setup

### 1. Database

```bash
# Local Postgres — creates the DB then runs schema + functions
psql -U postgres -f DB/phase1_init.sql
psql -U postgres -d sks_inventory -f DB/phase1_procedures.sql

# If you have an older DB without is_deleted columns:
psql -U postgres -d sks_inventory -f DB/migration_add_is_deleted.sql

# Seed at least one category so the Products form has options
psql -U postgres -d sks_inventory -c "
  INSERT INTO categories (name) VALUES
    ('Snacks'), ('Beverages'), ('Food'), ('Biscuits'), ('Dairy')
  ON CONFLICT (name) DO NOTHING;"
```

For **Supabase**: paste both SQL files in the SQL Editor (init first, procedures second). Comment out the `CREATE DATABASE` and `\c` lines in `phase1_init.sql` — Supabase uses its default `postgres` database.

### 2. Backend — connection string + JWT key

Both are placeholders in `appsettings.json`. Override per developer with `dotnet user-secrets`:

```bash
cd Backend/API
dotnet user-secrets set "ConnectionStrings:Default" "Host=localhost;Port=5432;Database=sks_inventory;Username=postgres;Password=YOUR_PASSWORD"
dotnet user-secrets set "Jwt:SigningKey" "<at-least-32-byte-random-string>"
```

### 3. Backend — build & run

```bash
cd Backend
dotnet build
dotnet run --project API
```

The API listens on `http://localhost:5219`. Swagger lives at `http://localhost:5219/swagger`.

On the first Development run, an `admin` user is auto-seeded using the credentials in `appsettings.json:Seed`. Default: **`admin / admin123`**.

### 4. Frontend — install + run

```bash
cd front-end
npm install
npm run dev
```

The Vite dev server opens at `http://localhost:5173` (or 5174 if 5173 is taken). Hot reload is on.

The frontend reads `VITE_API_URL` from `front-end/.env.local`. Default value:

```env
VITE_API_URL=http://localhost:5219
```

## API endpoints (Phase 1)

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/login` | anonymous |
| `GET POST PUT DELETE` | `/api/products` | Admin writes / any authed reads |
| `GET POST PUT DELETE` | `/api/inventories` | Admin writes / any authed reads |
| `GET POST PUT DELETE` | `/api/shops` | Admin writes / any authed reads |
| `GET POST PUT DELETE` | `/api/users` | Admin only |
| `PUT` | `/api/users/{id}/password` | Admin only |
| `GET` | `/api/categories` | any authed (read-only — categories managed via SQL for Phase 1) |
| `GET` | `/health` | anonymous (readiness check, pings DB) |

JWT lifetime is 1 hour. The token carries `userId`, `role`, and either `shopId` or `inventoryId` (depending on role). Every write operation stamps `created_by` / `updated_by` from the JWT.

## Phase 1 status

- [x] Auth (JWT + BCrypt + role-based authorization, real login flow wired end-to-end)
- [x] Landing page with three login entry points (Admin / Shop User / Inventory User)
- [x] Products — CRUD UI ↔ API integrated, auto-generated `P###` codes
- [x] Inventories — CRUD UI ↔ API integrated, `INV###` codes
- [x] Shops — CRUD UI ↔ API integrated, `SHP###` codes, GSTIN validation, mapped to inventory
- [x] Staff (Users) — CRUD UI ↔ API integrated, role/binding rules, password reset (no admin via UI)
- [x] Categories — `GET /api/categories` powering the Products form dropdown
- [x] Soft delete via `is_deleted` flag — deleted rows hidden from `GET` responses
- [x] Audit columns auto-stamped on every write
- [x] Health endpoint with DB ping for Railway/Supabase uptime probes
- [x] CORS — Dev allows any localhost port; UAT/Prod use strict allowlist
- [ ] Excel bulk import for products *(deferred)*

## Conventions

- **`active`** is a **business flag** — toggle from the Edit dialog, e.g. "shop temporarily closed." Inactive rows still appear in lists with the grey "Inactive" chip.
- **`is_deleted`** is the **soft-delete flag** — set only by `DELETE` endpoints. Deleted rows are completely hidden from `GET` lists and detail endpoints. Restorable only via SQL.
- **Auto-generated codes** — leave `code` blank on create and the DB allocates the next sequential value (`P001`, `INV001`, `SHP001`). Codes stay globally unique even across deleted rows (no reuse).
- **Audit columns** — `created_at`, `created_by`, `updated_at`, `updated_by` on every table; the API stamps them automatically.
- **Reserved usernames** — `admin` and `inventory` are reserved; only the seeded admin row uses `admin`.
- **Frontend pattern** — pages call hooks (`hooks/useXxx.ts`), hooks call the API layer (`api/xxx/api.ts`), API layer calls the typed `client.ts` wrapper. No `fetch` directly in pages.

## Environments

Three environments, picked via `ASPNETCORE_ENVIRONMENT` for the BE and `VITE_API_URL` for the FE:

| Env | When | Backend | Database | Frontend |
|-----|------|---------|----------|----------|
| **Development** | Local dev | Local `dotnet run` on `:5219` | Local Postgres `sks_inventory` | `npm run dev` on `:5173` |
| **UAT** | Client testing / staging | Railway (UAT service) | Supabase (UAT project) | Vercel (Preview env) |
| **Production** | Live | Railway (Prod service) | Supabase (Prod project) | Vercel (Production env) |

Per-env settings live in `appsettings.{Env}.json` (BE) and Vercel env vars (FE). Secrets (connection string, JWT key, admin seed password) are **never committed** — they come from `dotnet user-secrets` locally and from Railway env vars in the cloud.

### Required env vars on Railway (UAT / Production)

.NET reads nested config keys with `__` as the separator (e.g. `Jwt:SigningKey` → `Jwt__SigningKey`).

```
ASPNETCORE_ENVIRONMENT       = UAT     (or Production)
ASPNETCORE_URLS              = http://+:${PORT}
ConnectionStrings__Default   = Host=db.<project>.supabase.co;Port=5432;Database=postgres;Username=postgres;Password=<pwd>;SSL Mode=Require;Trust Server Certificate=true
Jwt__SigningKey              = <32+ random chars, generate fresh per env>
Jwt__Issuer                  = (optional override of appsettings)
Jwt__Audience                = (optional override of appsettings)
Seed__AdminPassword          = <strong password — required only on first deploy>
```

If `Seed__AdminPassword` is empty/missing, the auto-seed is skipped. Once the first deploy creates the admin row, you can drop the variable; subsequent boots see an existing admin and skip seeding.

### Required env vars on Vercel (UAT / Production)

```
VITE_API_URL  = https://kovilpatti-uat.up.railway.app   (or the Production Railway URL)
```

### CORS

Backend reads `Cors:AllowedOrigins` per environment.
- **Development** — any `localhost` / `127.0.0.1` origin is accepted regardless of port (Vite picks dynamically).
- **UAT / Production** — strict allowlist in `appsettings.UAT.json` / `appsettings.Production.json`. Update with the actual Vercel URLs once known.

### Swagger visibility

Always on in **Development**. In **UAT** / **Production**, controlled by `Swagger:Enabled` in the per-env appsettings file (default: on for UAT, off for Prod).

## Deployment (Phase 1)

1. **Database (Supabase, one project per env)**
   - Create the project, copy the connection string from Settings → Database.
   - In SQL Editor: paste `DB/phase1_init.sql` (comment out `CREATE DATABASE` and `\c` lines — Supabase uses the default `postgres` DB).
   - Then paste `DB/phase1_procedures.sql`.
   - Insert categories (see "First-time setup → Database" above).

2. **Backend (Railway, one service per env)**
   - Deploy from this GitHub repo, root directory `Backend/API`.
   - Set the env vars listed above. `ASPNETCORE_ENVIRONMENT` must match the target.
   - Generate a public domain (Settings → Networking).
   - Verify with `curl https://<railway-url>/health`.

3. **Frontend (Vercel, one project — different env vars per env)**
   - Connect the GitHub repo, set Root Directory to `front-end`.
   - Set `VITE_API_URL` per environment (Production / Preview).
   - Trigger a deploy.
