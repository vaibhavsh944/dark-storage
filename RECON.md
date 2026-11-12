# Reconnaissance Report (Phase 0)

## Commands
- **Package Manager**: `npm` workspaces (`workspaces: ["packages/*", "services/*", "apps/*"]`). (`pnpm` is not globally installed in PowerShell on this host; `npm` and `npx` are standard).
- **Install**: `npm install`
- **Build All**:
  ```bash
  npm run build -w @dark-storage/shared
  npm run build -w @dark-storage/engine1-scheduler
  npm run build -w @dark-storage/engine2-optimizer
  npm run build -w @dark-storage/engine3-inventory
  npm run build -w @dark-storage/gateway
  npm run build -w @dark-storage/web
  ```
- **Typecheck**: `npx tsc -b` or running `npm run build` across each workspace.
- **Start All**: `npm run dev` (uses concurrently for all 5 services: Engine 3, Engine 2, Engine 1, Gateway, Web) or `npx tsx scripts/start-all.ts`.
- **Start Individual Services**:
  - Gateway (Port 4000): `npm run dev -w @dark-storage/gateway` (or `npx tsx services/gateway/src/server.ts`)
  - Engine 1 Scheduler (Port 4001): `npm run dev -w @dark-storage/engine1-scheduler` (or `npx tsx services/engine1-scheduler/src/server.ts`)
  - Engine 2 Optimizer (Port 4002): `npm run dev -w @dark-storage/engine2-optimizer` (or `npx tsx services/engine2-optimizer/src/server.ts`)
  - Engine 3 Inventory (Port 4003): `npm run dev -w @dark-storage/engine3-inventory` (or `npx tsx services/engine3-inventory/src/server.ts`)
  - Web UI (Port 5173): `npm run dev -w @dark-storage/web` (or `npx vite` in `apps/web`)
- **Database Migrations & Seed**:
  - `npm run migrate` (runs `tsx scripts/migrate.ts`)
  - `npm run seed:base` (runs `tsx scripts/seed-base.ts`)
  - `npm run seed:demo` (runs `tsx scripts/seed-demo.ts`)
  - `npm run backup` (runs `tsx scripts/backup-db.ts`)
- **Tests**:
  - Unit & Integration: `npm test` (`vitest run`)
  - E2E Tests: `npm run test:e2e` (`vitest run --config vitest.e2e.config.ts`)
  - Smoke: `npx tsx scripts/smoke.ts`

---

## Architecture & DB Path (B.4 Answers)

### 1. Gateway DB vs Engine 3 Proxying
- **Location**: `services/gateway/src/server.ts:46-62`, `services/gateway/src/routes/*`, `services/engine3-inventory/src/server.ts:65`.
- **Finding**: Gateway **does NOT** open `data/warehouse.db` directly. There is zero `better-sqlite3` usage in `services/gateway`.
- All routes in `services/gateway/src/routes/*` forward requests:
  - To **Engine 3 (Inventory)**: via `callEngine3()` (`services/gateway/src/clients/engine3.ts`) targeting `http://localhost:4003/internal/v1/*` with header `x-internal-token: process.env.INTERNAL_SERVICE_KEY`.
  - To **Engine 1 (Scheduler)**: via `runViaEngine1()` (`services/gateway/src/clients/engine1.ts`) targeting `http://localhost:4001/internal/v1/tasks`.
  - To **Engine 2 (Optimizer)**: via `callEngine2()` targeting `http://localhost:4002/*`.
- **Database Connection**: `services/engine3-inventory/src/db/connection.ts` opens `data/warehouse.db` with `better-sqlite3`, WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`.
- **Single DB Path Invariant (D26)**: All state changes, ledger postings (`postLedger`), audit logs (`appendAudit`), and outbox events execute atomically within Engine 3 transactions on `warehouse.db`. Gateway acts strictly as an authenticated reverse proxy and WebSocket broadcaster.

### 2. Migration Execution
- **Location**: `scripts/migrate.ts:6-56` (`applyMigrations`).
- **Finding**: Migrations are **NOT** executed automatically inside `server.ts` upon service boot.
- They are executed via `scripts/migrate.ts` (`npm run migrate`).
- Migrations in `migrations/warehouse/*.sql` are applied to `data/warehouse.db`.
- Migrations in `migrations/scheduler/*.sql` are applied to `data/scheduler.db`.
- Tracking table is `schema_migrations` (`version TEXT PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT`). The `version` is extracted from the filename prefix (e.g. `001`, `002`, `s001`).

### 3. Exact Idempotency Header
- **Location**: `services/gateway/src/routes/*.ts` (e.g., `orders.ts:16`, `receipts.ts:14`, `picking.ts:18`), `services/engine3-inventory/src/domain/idempotency.ts:30-88`.
- **Finding**: Both headers are accepted: `idempotency-key` and `x-idempotency-key` (read via `(req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string)`).
- Table `idempotency_keys` stores `(key, scope, request_hash, status_code, response_json, created_at)`.

### 4. Zero-Quantity Inventory & Bins Handling
- **Location**: `services/engine3-inventory/src/domain/inventoryRepo.ts:193-201` (`stockOut`), `migrations/warehouse/003_inventory_ledger.sql:10`.
- **Finding**: When `qty` reaches 0 upon stock consumption:
  ```sql
  UPDATE inventory
  SET qty = qty - @q,
      reserved_qty = reserved_qty - CASE WHEN @consume = 1 THEN @q ELSE 0 END,
      sku = CASE WHEN qty - @q = 0 THEN NULL ELSE sku END,
      updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE bin_code = @bin AND qty >= @q
  ```
  The row in `inventory` is **kept** with `qty = 0` and `sku = NULL`. This is strictly constrained by SQLite check constraint:
  `CHECK ((qty = 0 AND sku IS NULL) OR (qty > 0 AND sku IS NOT NULL))` in `003_inventory_ledger.sql`.
  The `bins` table in `002_catalog_layout.sql` does not currently contain `current_sku` or `current_qty` columns; these will be maintained as projections in Phase 4 via `postLedger()`.

### 5. Seeded Accounts & Passwords
- **Location**: `scripts/seed-base.ts:15-21`.
- **Finding**:
  - `manager1`: role `MANAGER`, display `Manager`
  - `operator1`: role `OPERATOR`, display `Operator`
  - `picker1`: role `PICKER`, display `Picker`
  - `picker2`: role `PICKER`, display `Picker 2`
  - `staff1`: role `STAFF`, display `Staff`
  - Password: `Warehouse#2026` (via `SEED_DEFAULT_PASSWORD || 'Warehouse#2026'`, hashed with bcrypt 10 rounds).

### 6. `:stopRef` in `routes/picking.ts`
- **Location**: `services/gateway/src/routes/picking.ts:28`, `services/engine3-inventory/src/routes/picking.ts:33`, `migrations/warehouse/007_missions.sql:22`.
- **Finding**: Currently queries `WHERE ps.stop_ref = ?` using the string parameter `:stop_ref`. `pick_stops` has `stop_ref TEXT NOT NULL UNIQUE`.
- Standard in Phase 5: Lookup must accept either `stop_ref` (string ref such as `${mission_ref}-S${stop_seq}`) or numeric `pick_stops.id`.

---

## Route Inventory

### Gateway Routes (`services/gateway/src/routes/*`)
| Method | Path | Target / Handling | Notes |
|---|---|---|---|
| `GET` | `/health`, `/api/health` | Local + aggregated health of E1, E2, E3 | Public |
| `POST` | `/api/auth/login` | Calls E3 `/internal/v1/auth/verify`, signs JWT | Public |
| `GET` | `/api/auth/me` | Local JWT verification | Authenticated |
| `GET` | `/api/dashboard` | Proxies E3 `/internal/v1/dashboard` | Authenticated |
| `GET` | `/api/audit` | Proxies E3 `/internal/v1/audit` | MANAGER |
| `GET` | `/api/admin/integrity` | Proxies E3 `/internal/v1/integrity` | MANAGER |
| `GET` | `/api/products`, `/api/products/:sku` | Proxies E3 `/internal/v1/products` | Authenticated |
| `GET` | `/api/inventory` (summary) | Proxies E3 `/internal/v1/inventory/summary` | Authenticated |
| `GET` | `/api/inventory/bins` | Proxies E3 `/internal/v1/inventory/bins` | Authenticated |
| `GET` | `/api/inventory/bins/:code` | Proxies E3 `/internal/v1/inventory/bins/:code` | Authenticated |
| `GET` | `/api/inventory/movements` | Proxies E3 `/internal/v1/inventory/movements` | Authenticated |
| `POST` | `/api/inventory/bins/:code/status` | Proxies E3 `/internal/v1/inventory/bins/:code/status` | MANAGER |
| `POST` | `/api/inventory/bins/:code/recount` | Proxies E3 `/internal/v1/inventory/bins/:code/recount` | MANAGER (D11 -> 410) |
| `POST` | `/api/inventory/relocate` | Proxies E1 -> E3 relocation command | MANAGER, OPERATOR |
| `GET` | `/api/warehouse/layout` | Proxies E3 `/internal/v1/warehouse/layout` | Authenticated |
| `GET` | `/api/warehouse/search` | Proxies E3 `/internal/v1/warehouse/search` | Authenticated |
| `POST` | `/api/receipts` | Proxies E3 `/internal/v1/receipts` | MANAGER, OPERATOR |
| `GET` | `/api/receipts`, `/:ref`, `/staged` | Proxies E3 `/internal/v1/receipts/*` | Authenticated |
| `POST` | `/api/placement/recommend` | Proxies E2 `/recommend` | MANAGER, OPERATOR |
| `POST` | `/api/placement/validate` | Proxies E2 `/validate` | MANAGER, OPERATOR |
| `POST` | `/api/putaways` | Dispatches via E1 -> E3 | MANAGER, OPERATOR |
| `GET` | `/api/putaways` | Proxies E3 `/internal/v1/putaways` | Authenticated |
| `POST` | `/api/orders` | Dispatches order reservation via E1 -> E3 | MANAGER |
| `GET` | `/api/orders`, `/:ref` | Proxies E3 `/internal/v1/orders` | Authenticated |
| `POST` | `/api/orders/:ref/cancel` | Proxies E3 `/internal/v1/orders/:ref/cancel` | MANAGER |
| `POST` | `/api/orders/:ref/assign` | Dispatches mission assignment via E1 -> E3 | MANAGER (D11 -> 410) |
| `POST` | `/api/orders/:ref/reassign` | Proxies E3 `/internal/v1/orders/:ref/reassign` | MANAGER |
| `POST` | `/api/orders/:ref/pack` | Proxies E3 `/internal/v1/orders/:ref/pack` | STAFF, MANAGER (D11 -> 410) |
| `GET` | `/api/missions`, `/:ref` | Proxies E3 `/internal/v1/missions` | Authenticated |
| `POST` | `/api/missions/:ref/start` | Proxies E3 `/internal/v1/missions/:ref/start` | PICKER, MANAGER |
| `POST` | `/api/pick-stops/:stop_ref/confirm` | Dispatches PICK_CONFIRM via E1 -> E3 | PICKER, MANAGER (D11 -> 410) |
| `POST` | `/api/pick-stops/:stop_ref/exception` | Proxies E3 `/internal/v1/pick-stops/:ref/exception` | PICKER, MANAGER |
| `GET` | `/api/exceptions`, `/:ref` | Proxies E3 `/internal/v1/exceptions` | Authenticated |
| `POST` | `/api/exceptions/:ref/resolve` | Proxies E3 `/internal/v1/exceptions/:ref/resolve` | MANAGER |
| `GET` | `/api/packing/queue` | Proxies E3 `/internal/v1/packing/queue` | Authenticated |
| `POST` | `/api/packing/:ref/pack` | Proxies E3 `/internal/v1/orders/:ref/pack` | STAFF, MANAGER (D11 -> 410) |
| `GET` | `/api/tasks`, `/:id`, `/locks`, `/queue` | Proxies E1 `/internal/v1/tasks/*` | MANAGER |
| `GET` | `/api/users` | Proxies E3 `/internal/v1/users` | MANAGER |

### Engine 3 Internal Routes (`services/engine3-inventory/src/routes/*`)
Prefix: `/internal/v1` (protected with `internalAuth`).
- `/auth/verify` (`POST`): Verify username & password against `users` table
- `/products`, `/products/:sku` (`GET`): Catalog query
- `/integrity`, `/admin/integrity` (`GET`): Run database consistency checks (I01–I06)
- `/inventory/summary`, `/inventory/bins`, `/inventory/bins/:code`, `/inventory/movements` (`GET`): Stock queries
- `/inventory/bins/:code/status` (`POST`): Update bin status
- `/inventory/bins/:code/recount` (`POST`): Reset recount flag (legacy)
- `/warehouse/layout`, `/warehouse/search` (`GET`): Floor geometry & bin search
- `/receipts` (`POST`), `/receipts/staged` (`GET`), `/receipts/:ref` (`GET`): Receiving operations
- `/putaways` (`GET`): Putaway queries
- `/commands/:commandName` (`POST`): Direct command dispatcher (e.g. `RELOCATE`, `PUTAWAY_CONFIRM`, `PICK_CONFIRM`, `ORDER_CREATE`, `ORDER_ASSIGN`)
- `/orders` (`GET`), `/orders/:ref` (`GET`), `/orders/:ref/cancel` (`POST`), `/orders/:ref/assign` (`POST`), `/orders/:ref/reassign` (`POST`)
- `/missions` (`GET`), `/missions/:ref` (`GET`), `/missions/:ref/start` (`POST`), `/missions/:ref/reroute-input` (`GET`), `/missions/:ref/reroute` (`POST`)
- `/pick-stops/:ref` (`GET`), `/pick-stops/:ref/exception` (`POST`)
- `/exceptions` (`GET`), `/exceptions/:ref` (`GET`), `/exceptions/:ref/resolve` (`POST`)
- `/packing/queue` (`GET`), `/orders/:ref/pack` (`POST`)
- `/dashboard` (`GET`), `/audit` (`GET`), `/users` (`GET`), `/pickers` (`GET`), `/outbox` (`GET`)

### Engine 1 Internal Routes (`services/engine1-scheduler/src/routes/*`)
Prefix: `/internal/v1` (protected with `internalAuth`).
- `/tasks` (`POST`): Enqueue idempotent task with fencing-token locks
- `/tasks` (`GET`), `/tasks/:id` (`GET`): Task status and result
- `/locks` (`GET`): Current resource locks held
- `/queue` (`GET`): Queued task metrics
- `/stats` (`GET`): Scheduler statistics

### Engine 2 Stateless Routes (`services/engine2-optimizer/src/routes/*`)
- `/recommend` (`POST`): Recommend target bins for putaway
- `/validate` (`POST`): Validate shelf/bin constraints
- `/plan` (`POST`): Compute TSP shortest picking path

---

## Baseline Verification
- SQLite DBs: `data/warehouse.db` and `data/scheduler.db` backed up to `data/backup-baseline/`.
- Smoke test script: `scripts/smoke.ts` written and verified.
- Execution: `npx tsx scripts/smoke.ts` exited with code 0 (`gateway: ok, engine1: ok, engine2: ok, engine3: ok`, manager1 login ok, dashboard ok, orders ok, inventory summary ok).
- Full Vitest suite: 19 test files, 289 tests passed in 73s.
- Workspace build: `@dark-storage/shared`, `@dark-storage/web`, and all backend services built cleanly.
