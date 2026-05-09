# Inventory — Phase 1

Frontend-only Phase 1 demo for the **Kovilpatti Murukku & Snacks kadai** inventory management system. Built to showcase the UI flow (landing → login → dashboard → products) to the client without any backend dependency.

All data lives in-memory via React Context with seeded products. Every CRUD operation (add / edit / delete) works locally — no API calls, no database.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript |
| Build tool | Vite |
| UI library | Material UI v9 (MUI Core + MUI X DataGrid) |
| Styling | Tailwind CSS v4 |
| Routing | React Router v7 |
| Icons | Lucide React |
| Fonts | Plus Jakarta Sans, DM Serif Display |

## Theme

Glassmorphism design with a soft blue-gray background and a warm cream center glow. Frosted white glass surfaces (sidebar, header, cards, dialogs) sit on top with backdrop-blur. Yellow accents (logo, active nav, primary buttons) pop as brand colors.

## Features

- **Landing page** — branded welcome card and admin entry point.
- **Admin login** — local credential check, persists session in `localStorage`.
- **Dashboard** — live stat cards (Total Products, Categories) + recently added products table (DataGrid).
- **Products** — full CRUD via DataGrid:
  - Add product with auto-generated ID (`P###`) and SKU (`{category-prefix}-{id}`).
  - Edit product (ID/SKU read-only).
  - Delete product with MUI confirmation dialog (no native `confirm()`).
- **Responsive** — sidebar collapses to a drawer below `lg` (1024px) with a hamburger menu.
- **Form validation** — required fields, weight + price numeric checks, dialog-driven errors.
- **MUI Dialog-based prompts** — no native `alert()` or `confirm()` anywhere.

## Folder structure

```
inventory-phase1/
├── public/
│   └── snack-bg.png           # available for theme bg (currently unused)
├── src/
│   ├── components/
│   │   ├── ConfirmDialog.tsx  # reusable MUI confirm dialog
│   │   ├── Layout.tsx         # admin shell — sidebar + header + outlet
│   │   ├── PageHeader.tsx     # page title + subtitle + action slot
│   │   ├── Sidebar.tsx        # admin nav (responsive drawer support)
│   │   └── StatCard.tsx       # frosted glass stat tile
│   ├── context/
│   │   └── AppContext.tsx     # auth state + products CRUD (in-memory)
│   ├── data/
│   │   └── seedProducts.ts    # 20 sample products
│   ├── pages/
│   │   ├── AdminLogin.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Landing.tsx
│   │   └── Products.tsx
│   ├── App.tsx                # routes
│   ├── index.css              # Tailwind import + body bg + global font
│   ├── main.tsx               # React mount
│   ├── theme.ts               # MUI theme overrides (glass paper, yellow primary)
│   └── types.ts               # Product + CurrentUser types
├── index.html                 # Google Fonts + root mount
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts
└── eslint.config.js
```

## Routes

| Route | What it renders |
|-------|-----------------|
| `/` | Landing |
| `/admin/login` | Admin Login |
| `/admin` | Dashboard (under Layout, requires login) |
| `/admin/products` | Products (under Layout, requires login) |

Unauthenticated visits to `/admin/*` redirect to `/admin/login`.

## Demo credentials

```
Username: admin
Password: admin123
```

## Getting started

### Prerequisites
- Node.js 18+ and npm

### Install

```bash
cd inventory-phase1
npm install
```

### Run dev server

```bash
npm run dev
```

The app will start at `http://localhost:5173/` (Vite picks the next free port if 5173 is busy — read the terminal output).

### Build for production

```bash
npm run build
```

Output is emitted to `dist/`.

### Preview the production build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## State & data

- **Auth**: `AppContext.login(username, password)` — checks against hardcoded `admin/admin123`, sets `currentUser`, persists via `localStorage`.
- **Products**: 20 seeded products in `data/seedProducts.ts`. CRUD via `addProduct`, `updateProduct`, `deleteProduct` on the context — instant updates, no network round-trips.
- **No external API** — to add a backend later, replace the in-memory functions in `AppContext.tsx` with `fetch()` calls.

## Notes for Phase 2

- This is a **demo** — refreshing the browser resets product changes (only the auth session persists).
- The image at `public/snack-bg.png` is no longer wired up to the theme but kept for reference.
- The Glass theme uses `backdrop-filter: blur(...)` — works on all modern browsers (Chrome, Edge, Firefox 103+, Safari 14+).
- When integrating with a real backend (.NET / Node / etc.), swap `AppContext` CRUD methods to call API endpoints; pages already use the abstraction so no UI changes will be needed.
