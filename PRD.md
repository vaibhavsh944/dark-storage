# PRD: Dark Store WMS Upgrade
Segregation of Duties (4-Role Model), Append-Only Stock Ledger, Real-World Floor Flows
Repo: `d:\mini project final` (pnpm monorepo: `services/gateway`, `services/engine1-scheduler`, `services/engine2-optimizer`, `services/engine3-inventory`, `apps/web`, `packages/shared`).

Implementer: a small coding model with a limited context window. This file is written to be read in pieces using `grep` and `sed`.

---

# PART A: READ THIS FIRST (AGENT PROTOCOL)

## A.0 Resume protocol (every new session, every context reset)
1. Open `PROGRESS.md` (create it in `P0-T1` if missing). Find the first unticked `- [ ] Pn-Tm` task. That is your active task.
2. Read `RECON.md` (facts you discovered in Phase 0: commands, file paths, header names, schema quirks). Do not rediscover them.
3. Read this file's Parts A to D (skim), the `REF-*` sections your task names, and your active `PHASE` section only.
4. Work on that single task. Run its verification checks. Tick it in `PROGRESS.md`. Commit. Update `PROGRESS.md` with a one-line `next: Pn-Tm` note at the bottom.

## A.1 How to read this file (MANDATORY)
1. **Do NOT read this whole file at once.** It is structured for line-range slicing. Get the outline first:
   `grep -n "^# \|^## " PRD.md`
2. Read Parts A, B, C, D once at the start of a session.
3. Read only the `## PHASE n` section you are currently working on: from its `## PHASE n` heading to the next `## PHASE` heading using `sed -n 'START,ENDp' PRD.md` (or line-bounded file read tool). Also read only the specific `## REF-x` sections that your phase explicitly lists at the top.
4. Never re-read finished phases. Never read ahead into future phases.
5. When a source file you must edit is longer than 250 lines, inspect it with `grep -n` first and read only the target line range.

## A.2 Working loop (repeat for every task Pn-Tm)
1. Read the task specification. Open ONLY the files it names.
2. Make the change exactly as specified. Use the exact function names, file paths, table/column names, and error codes given.
3. Run the task's `CHECK` commands and the workspace typecheck/build command recorded in `RECON.md`.
4. If green: tick `- [x] Pn-Tm` in `PROGRESS.md`, then run `git add -A && git commit -m "Pn-Tm: <short title>"` (if git is initialized).
5. If red: fix it. If stuck after 3 attempts, log the blocker to `BLOCKERS.md` (`task_id`, exact error, what was tried) and move to the next task that does not depend on it.
6. Write small, modular files. If a new file would exceed ~250 lines, split it by responsibility.

## A.3 Hard rules
- **Strictly 4 Roles**: Only `MANAGER`, `OPERATOR`, `PICKER`, and `STAFF` exist. Never add `ADMIN`, `DISPATCH`, or `AUDITOR` roles.
  - `MANAGER`: Control Tower, Exceptions, Approvals, Audits, System Config, Force-Unassign. **Cannot execute physical floor work.**
  - `OPERATOR`: Inbound Receiving, Putaway, Replenishment, Relocation, Blind Cycle Counting, Damage Flagging. **Cannot touch customer orders or approve adjustments.**
  - `PICKER`: Outbound Mission Claim, 3-Step Barcode Picking, Put-Back, Repick, Exception Raising. **Blind to bin inventory totals.**
  - `STAFF`: Packing Bench (Tote Activation, Item Scan, Weight Check, Bagging, Repick Trigger) AND Dispatch Bench (Staging Slot & Rider OTP Handover).
- **Never ask the user questions.** Decide using Part C (Decision Log). If an edge case is not covered, pick the simplest deterministic option and append one line to `DECISIONS_NEW.md` (`id | choice | why`).
- **Never edit an applied migration** (`001..009`, `s001`, or any migration you already committed). Always create the next numbered `.sql` migration file.
- **Never invent endpoints, tables, columns, enum values, permissions, or error codes** not defined in this PRD unless logged in `DECISIONS_NEW.md`.
- **Never write stock quantities directly** (`UPDATE inventory`, `INSERT INTO inventory`, `UPDATE bins SET current_qty`) outside `services/engine3-inventory/src/ledger/postLedger.ts` (created in Phase 4).
- **Never check roles by name in route guards or UI components** (`role === 'MANAGER'` is forbidden). Always use `can(user, 'perm:action')` (Phase 1). The only place role names map to strings is inside `ROLE_PERMISSIONS` (`REF-1`) and seed scripts.
- **Never verify a barcode scan on the client.** The client sends the raw scanned string; the server normalizes and validates it (`D14`).
- **Never leave the application broken.** After every phase: all 4 backend services start, `apps/web` builds cleanly, login works, and `scripts/smoke.ts` passes.
- Keep code TypeScript strict, ESM (`"type": "module"`), matching the surrounding file import style.
- Floor UI screens (`/floor/*`) must be plain, high-contrast HTML/CSS with zero 3D/Canvas overhead (`D18`).
- Do not paste secrets or plaintext passwords into `apps/web` (`P2-T5` removes the existing `Warehouse#2026` bundle leak).

## A.4 Self-check before ticking any task
- [ ] Did I modify only the files named in this task (plus its test file)?
- [ ] Did `pnpm -r exec tsc --noEmit` (or the typecheck script) pass with 0 errors?
- [ ] Did I run the task's `CHECK` commands and verify the output?
- [ ] Did every new mutating endpoint get: `authMiddleware` -> `requirePerm(...)` -> `idempotency` -> single `runInTx` transaction writing state + `postLedger` (if stock moves) + `appendAudit` + `outbox_events` (+ `order_events` if order-related)?
- [ ] Did every error throw `AppError` with an official code from `REF-5`?

## A.5 Phase map (priority: MUST > SHOULD > WOW)
| Phase | Title | Priority | Depends on |
|---|---|---|---|
| **P0** | Recon and baseline verification | MUST | none |
| **P1** | Foundations: 4-role permissions, config, state machine lib, test harness | MUST | P0 |
| **P2** | RBAC enforcement (gateway + web) & removal of Manager execution powers | MUST | P1 |
| **P3** | Hash-chained tamper-evident audit log + order event history | MUST | P1 |
| **P4** | Append-only stock ledger (locations, lots, reconciliation) | MUST | P1, P3 |
| **P5** | Totes, mission self-claim, task leases/heartbeats, floor tasks, 3-step picking | MUST | P2, P4 |
| **P6** | Packing bench (tote scan, item scan, weight check) + Staff Dispatch OTP handover | MUST | P5 |
| **P7** | Exception recovery loop + blind counts + dual-control adjustments + quarantine | MUST | P5, P6 |
| **P8** | Inbound: PO/ASN 3-way match, QC & min shelf-life, lots/expiry, FEFO, RTV | SHOULD | P4, P7 |
| **P9** | Explainable allocator, min/max auto-replenishment, re-slotting what-if | SHOULD | P4, P5 |
| **P10** | SLA-aware scheduler, mid-pick cancellation put-back, SINGLE vs BATCH picking | SHOULD | P5, P7 |
| **P11** | Manager Control Tower, KPIs, ABC cycle-count scheduling, expiry sweep, shrinkage | SHOULD | P7, P8 |
| **P12** | Floor UX: scanner wedge input, scan simulator, Badge/PIN login, offline queue | SHOULD | P5, P6 |
| **P13** | Order wave simulator, 20-picker concurrency bots, recall trace, event replay, tamper demo | WOW | P8, P11, P12 |
| **P14** | Full integration test suite, rich seed data, SoD architecture docs, demo script | MUST | all |

Build order is `P0` through `P14`. `MUST` phases (`P0–P7`, `P14`) form the non-negotiable core. Complete all phases sequentially.

---

# PART B: PROJECT FACTS (GROUNDED FROM CODEBASE)

The existing schema in `migrations/warehouse/001..009` and `migrations/scheduler/s001` is authoritative.

## B.1 Stack and ports
| Service | Tech | Port | DB / Notes |
|---|---|---|---|
| **Web (`apps/web`)** | React 18, Vite 5, React Router 6, TanStack Query 5, Zustand 4, M3 CSS | `5173` | Proxies `/api` and `/ws` to `localhost:4000` |
| **Gateway (`services/gateway`)** | Express 4, JWT (`12h`), bcrypt, idempotency, WebSocket hub `/ws` | `4000` | Reverse proxy + auth + outbox poller (1000ms) |
| **Engine 1 (`services/engine1-scheduler`)** | Express 4, `better-sqlite3`, fencing-token locks, worker loop | `4001` | `data/scheduler.db` (`tasks`, `locks`, `lock_tokens`, `task_events`) |
| **Engine 2 (`services/engine2-optimizer`)** | Express 4, Dijkstra, Held-Karp TSP, 2-Opt, candidate bin scorer | `4002` | Stateless compute (`routing`, `placement`) |
| **Engine 3 (`services/engine3-inventory`)** | Express 4, `better-sqlite3`, double-entry ledger, SQL triggers | `4003` | `data/warehouse.db` (WAL mode, `foreign_keys = ON`) |

- Inter-service auth header: `x-internal-token` matching `process.env.INTERNAL_SERVICE_KEY`.
- Shared package import: `@dark-storage/shared` (`packages/shared/src/{index,enums,types,dtos}.ts`).

## B.2 Existing tables and exact columns (`data/warehouse.db`)
- **`001_core.sql`**:
  - `users(id TEXT PK, username TEXT UNIQUE, password_hash TEXT, role TEXT CHECK(role IN ('MANAGER','OPERATOR','PICKER','STAFF')), display_name TEXT, active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`
  - `id_sequences(entity_type TEXT PK, current_value INTEGER, updated_at TEXT)`
  - `audit_log(id INTEGER PK AUTOINCREMENT, at TEXT, actor TEXT, role TEXT, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT)`
  - `outbox_events(seq INTEGER PK AUTOINCREMENT, event_id TEXT UNIQUE, topic TEXT, aggregate_type TEXT, aggregate_id TEXT, payload TEXT, created_at TEXT, published_at TEXT)`
  - `idempotency_keys(key TEXT, scope TEXT, request_hash TEXT, response_code INTEGER, response_body TEXT, created_at TEXT, PRIMARY KEY(key, scope))`
- **`002_catalog_layout.sql`**:
  - `products(sku TEXT PK, name TEXT, category TEXT, storage_class TEXT CHECK IN ('STANDARD','HAZMAT','TEMPERATURE_CONTROLLED','SECURE','BULK'), max_receive_qty INTEGER, min_shelf_level INTEGER, max_shelf_level INTEGER, is_active INTEGER, created_at TEXT, updated_at TEXT)`
  - `nav_nodes(id TEXT PK, kind TEXT, label TEXT, x REAL, y REAL, z REAL, floor INTEGER, created_at TEXT)`
  - `nav_edges(id INTEGER PK, from_node TEXT, to_node TEXT, distance_cm INTEGER, bidirectional INTEGER, traversal_cost REAL, created_at TEXT)`
  - `shelves(code TEXT PK, aisle TEXT, bay INTEGER, status TEXT CHECK IN ('ACTIVE','MAINTENANCE','INACTIVE'), storage_class TEXT, access_node_id TEXT, x REAL, y REAL, width_cm INTEGER, depth_cm INTEGER, height_cm INTEGER, created_at TEXT, updated_at TEXT)`
  - `bins(code TEXT PK, shelf_code TEXT, level INTEGER CHECK(level BETWEEN 1 AND 10), capacity INTEGER, status TEXT CHECK IN ('AVAILABLE','RESERVED','OCCUPIED','BLOCKED','DAMAGED','RECOUNT_REQUIRED'), recount_required INTEGER, current_sku TEXT, current_qty INTEGER, created_at TEXT, updated_at TEXT)`
- **`003_inventory_ledger.sql`**:
  - `inventory(bin_code TEXT PK, sku TEXT, qty INTEGER, reserved_qty INTEGER, storage_class TEXT, updated_at TEXT)`
  - `stock_movements(id INTEGER PK, ref TEXT UNIQUE, movement_type TEXT CHECK IN ('RECEIPT','PUTAWAY','PICK','RELOCATION','ADJUSTMENT'), movement_kind TEXT CHECK IN ('INBOUND','OUTBOUND','INTERNAL'), sku TEXT, qty INTEGER, from_bin_code TEXT, to_bin_code TEXT, related_ref TEXT, performed_by TEXT, notes TEXT, created_at TEXT)`
  - View `v_available_stock` + triggers: `inventory_capacity_insert`, `inventory_capacity_update`, `inventory_sku_mix`, `inventory_receivable`, `inventory_storage_class`.
- **`004_receiving.sql`**:
  - `receipts(id INTEGER PK, ref TEXT UNIQUE, status TEXT CHECK IN ('PENDING','RECEIVED','CANCELLED'), supplier TEXT, reference_no TEXT, notes TEXT, received_at TEXT, received_by TEXT, created_at TEXT, updated_at TEXT)`
  - `receipt_lines(id INTEGER PK, receipt_ref TEXT, sku TEXT, qty_received INTEGER, qty_put_away INTEGER, status TEXT CHECK IN ('STAGED','PARTIALLY_PUT_AWAY','COMPLETED','CANCELLED'), created_at TEXT, updated_at TEXT)`
- **`005_putaway.sql`**:
  - `putaways(id INTEGER PK, ref TEXT UNIQUE, receipt_ref TEXT, receipt_line_id INTEGER, sku TEXT, qty INTEGER, source TEXT, dest_shelf TEXT, dest_bin TEXT, selection_mode TEXT CHECK IN ('RECOMMENDED','MANUAL'), movement_ref TEXT, performed_by TEXT, created_at TEXT)`
- **`006_orders.sql`**:
  - `orders(id INTEGER PK, ref TEXT UNIQUE, type TEXT, status TEXT CHECK IN ('DRAFT','RESERVED','ASSIGNED','PICKING','PICKED','PACKED','COMPLETED','CANCELLED','PARTIALLY_FULFILLED','FAILED'), priority INTEGER CHECK IN (100,200,300,400), customer TEXT, shipping_address TEXT, carrier TEXT, service_level TEXT, notes TEXT, items_total INTEGER, items_fulfilled INTEGER, cancelled_reason TEXT, created_by TEXT, created_at TEXT, updated_at TEXT)`
  - `order_lines(id INTEGER PK, order_ref TEXT, line_number INTEGER, sku TEXT, qty_ordered INTEGER, qty_reserved INTEGER, qty_picked INTEGER, status TEXT CHECK IN ('PENDING','RESERVED','PARTIALLY_RESERVED','PICKED','CANCELLED'), created_at TEXT, updated_at TEXT)`
  - `reservations(id INTEGER PK, order_ref TEXT, order_line_id INTEGER, bin_code TEXT, sku TEXT, qty INTEGER, status TEXT CHECK IN ('ACTIVE','RELEASED','FULFILLED'), created_at TEXT, updated_at TEXT)`
- **`007_missions.sql`**:
  - `missions(id INTEGER PK, ref TEXT UNIQUE, order_ref TEXT, status TEXT CHECK IN ('CREATED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED','FAILED'), picker_id TEXT, total_stops INTEGER, completed_stops INTEGER, distance_meters REAL, estimated_seconds INTEGER, started_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT)`
  - `pick_stops(id INTEGER PK, mission_ref TEXT, stop_seq INTEGER, bin_code TEXT, sku TEXT, qty_to_pick INTEGER, qty_picked INTEGER, status TEXT CHECK IN ('PENDING','IN_PROGRESS','CONFIRMED','EXCEPTION'), confirmed_at TEXT, created_at TEXT)`
- **`008_exceptions.sql`**:
  - `pick_exceptions(id INTEGER PK, ref TEXT UNIQUE, mission_ref TEXT, stop_id INTEGER, bin_code TEXT, sku TEXT, exception_type TEXT CHECK IN ('SHORTAGE','DAMAGED','WRONG_ITEM','BIN_EMPTY','BARCODE_UNREADABLE'), expected_qty INTEGER, actual_qty INTEGER, reason TEXT, resolution TEXT CHECK IN ('RECOUNT_REQUESTED','RESCHEDULE_STOP','SUBSTITUTE_BIN','CANCEL_LINE','WRITE_OFF'), resolution_notes TEXT, reported_by TEXT, resolved_by TEXT, resolved_at TEXT, created_at TEXT)`
- **`009_packing.sql`**:
  - `packing_records(id INTEGER PK, ref TEXT UNIQUE, order_ref TEXT UNIQUE, packed_by TEXT, total_items INTEGER, fulfilment_type TEXT CHECK IN ('FULL','PARTIAL'), carton_type TEXT, tracking_number TEXT, notes TEXT, created_at TEXT)`

## B.3 Problems in the current codebase that this PRD fixes
1. **Broken Segregation of Duties (SoD)**: `MANAGER` can currently receive (`POST /api/receipts`), putaway (`POST /api/putaway`), relocate (`POST /api/inventory/relocate`), recount (`POST /api/inventory/bins/:code/recount`), confirm pick stops (`POST /api/pick-stops/:stopRef/confirm`), and pack orders (`POST /api/orders/:ref/pack`).
2. **No Frontend or GET Route Guards**: `ProtectedLayout` in `apps/web/src/App.tsx` only checks token existence. Most `GET` endpoints only run `authMiddleware`.
3. **No Self-Claim, Tote Chain-of-Custody, or 3-Step Barcode Verification**: Pickers cannot claim missions; they click a single button without scanning bin, item, or tote barcodes.
4. **No Location-Based Append-Only Ledger**: Stock is decremented in-place in `inventory` at pick confirmation instead of moving across `EXT -> STAGED -> BIN -> TOTE -> BENCH -> DISP -> SHIPPED / QUAR / LOST`.
5. **Single-Step Unverified Adjustments**: Managers directly overwrite bin quantities in `/recount` or `/exceptions/:ref/resolve` without blind operator counting or four-eyes approval (`approver != requester`, dual-manager sign-off for high value).
6. **Hardcoded Plaintext Passwords in Client**: `AppShell.tsx` embeds `Warehouse#2026` in the frontend bundle.
7. **Mutable Audit Log**: `audit_log` has no SHA-256 hash chain or immutability triggers.

## B.4 Things the agent must VERIFY in Phase 0 (write exact answers in `RECON.md`)
- How migrations are applied (`services/engine3-inventory/src/db.ts` and `services/engine1-scheduler/src/db.ts`).
- Whether Gateway executes SQL directly against `warehouse.db` or proxies HTTP requests to `Engine 3` (`localhost:4003`), and which routes live in `services/gateway/src/routes/*` vs `services/engine3-inventory/src/routes/*`.
- Exact header name expected by `services/gateway/src/middleware/idempotency.ts`.
- How `services/engine3-inventory/src/ledger/*` currently handles `inventory` rows when `qty` reaches `0` (deleted vs kept with `qty = 0`, and how `bins.current_sku` / `bins.status` are updated).
- Whether `pick_stops` URL parameter `:stopRef` in `routes/picking.ts` expects `pick_stops.id` (numeric) or a string ref.

---

# PART C: DECISION LOG (FOLLOW THESE; DO NOT RE-DECIDE)

| ID | Decision |
|---|---|
| **D1** | **Incremental upgrade, no rewrite.** Add new numbered migrations (`010..022`). Keep existing visual themes (`theme.css`, `global.css`) and 2D/3D views for `MANAGER`. |
| **D2** | **Ledger is truth; `inventory` and `bins.current_qty` are projections.** From Phase 4 onward, only `postLedger()` may mutate `inventory` or `bins.current_qty`. |
| **D3** | **Permissions, not role names.** Define `ROLE_PERMISSIONS` for the 4 roles (`MANAGER`, `OPERATOR`, `PICKER`, `STAFF`) in `packages/shared/src/permissions.ts` (`REF-1`). Both backend and web use `can(user, perm)`. Login and `/api/auth/me` return `permissions: string[]`. |
| **D4** | **State machine as data.** All state transitions for `ORDER`, `MISSION`, `PICK_STOP`, `EXCEPTION`, `ADJUSTMENT`, `FLOOR_TASK` live in `packages/shared/src/stateMachine.ts` (`REF-2`) and execute via `transition()`. |
| **D5** | **Strictly 4 Roles (`MANAGER`, `OPERATOR`, `PICKER`, `STAFF`).** Consolidate capabilities cleanly: `MANAGER` owns Control Tower, Exceptions, Approvals, Audits, and Config/Admin tools; `OPERATOR` owns Inbound, Putaway, Relocation, Replenishment, Blind Counts, and Damage Flags; `PICKER` owns Mission Claim, 3-Step Picking, Put-Back, and Repick; `STAFF` owns Packing Bench AND Dispatch Rider Handover. |
| **D6** | **Strict Manager Hard-Stop (SoD).** `MANAGER` cannot execute any physical floor operation (`inbound:receive`, `putaway:execute`, `relocate:execute`, `count:execute`, `adjust:request`, `pick:execute`, `pack:execute`, `dispatch:handover`). |
| **D7** | **Order Creator SoD.** In addition to permission guards (`MANAGER` cannot pick or pack), enforce `actor.id !== order.created_by` on picking and packing mutations as a defence-in-depth invariant. |
| **D8** | **One lot per bin (and one SKU per bin).** Putaway or relocation of a different `lot_id` into a non-empty bin is rejected with `422 LOT_MIX`. |
| **D9** | **Split `PACKED` from `DISPATCHED`.** Packing moves stock from `TOTE` -> `BENCH` -> `DISP:<slot>` and sets order status to `PACKED`. Stock leaves the building (`DISP:<slot>` -> `SHIPPED`, status `DISPATCHED`) only when `STAFF` completes Rider Handover with a 4-digit OTP. |
| **D10** | **Partial fulfilment.** Orders completed with shorted/flagged items transition to `PACKED` with `packing_records.fulfilment_type = 'PARTIAL'` (and then `DISPATCHED`). Existing `PARTIALLY_FULFILLED` rows are migrated to `PACKED`. |
| **D11** | **Old shortcut endpoints return `410 ENDPOINT_REMOVED`.** Specifically: `POST /api/orders/:ref/pack`, `POST /api/packing/:ref/pack`, `POST /api/pick-stops/:stopRef/confirm`, `POST /api/inventory/bins/:code/recount`, `POST /api/orders/:ref/assign`. |
| **D12** | **Periodic background jobs.** Lease sweep, exception escalation, auto-replenishment, expiry sweep, and cycle-count scheduling run as `setInterval` jobs registered in `src/jobs/index.ts` and logged in table `job_runs`. |
| **D13** | **Money is integer paise (`*_paise`).** Config thresholds are in INR and multiplied by `100` when compared against `value_paise`. |
| **D14** | **Server-side barcode verification.** Barcodes are plain strings (`REF-4`). Every scan endpoint receives the raw scanned string and validates it on the server. |
| **D15** | **Pickers and Counters are blind.** Picker DTOs never include `currentQty`, `reservedQty`, `availableQty`, customer details, or prices. Count task DTOs never include `system_qty`. Enforced by `floorDtos.ts` (`REF-8`). |
| **D16** | **Idempotency on every mutating call.** Client sends the idempotency header on every POST/PUT/PATCH, including barcode scans. |
| **D17** | **Dev tooling is env-gated.** The Role Switcher and Scan Simulator appear only when `VITE_DEMO_MODE=true`. Backend `/api/auth/dev-switch` and `/api/dispatch/demo-otp/:orderRef` work only when `DEMO_MODE=true` and `NODE_ENV !== 'production'`. |
| **D18** | **Low-end PC friendly floor UI.** Floor routes (`/floor/pick`, `/floor/pack`, `/floor/operator`) use fast, high-contrast HTML/CSS. 2.5D Isometric Twin (`TwinView.tsx`) is lazy-loaded and restricted to `MANAGER`. |
| **D19** | **SQLite concurrency & deadlock prevention.** Every write uses `db.transaction(fn).immediate()` (`BEGIN IMMEDIATE`), `PRAGMA busy_timeout = 5000`, and strict **sorted lock ordering** (sort all location keys / bin codes lexicographically before touching rows). |
| **D20** | **Optimistic locking (`version` column).** `missions`, `floor_tasks`, `orders`, and `inventory_adjustments` have `version INTEGER NOT NULL DEFAULT 0`. Claims and transitions run `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?` and throw `409 VERSION_CONFLICT` if `changes !== 1`. |
| **D21** | **Mandatory reason codes.** Required on exception resolve, adjustment request/approve/reject, order cancel, force-unassign, and manual bin override. Values in `REF-5b`. `OTHER` requires a `note` of `>= 10` characters. |
| **D22** | **Four-eyes dual-control adjustments (within 4 roles).** `OPERATOR` requests (`requested_by`). `MANAGER` approves (`manager_id`). Guard 1: `actor.id !== requested_by` (`SELF_APPROVAL_FORBIDDEN`). Guard 2: If `value_paise >= adjust.high_threshold_inr * 100`, a **second distinct Manager** (`manager2_id !== manager_id && manager2_id !== requested_by`) must approve (`PENDING_SECOND_MANAGER` -> `APPLIED`). Seed `manager1` and `manager2` accounts so two-manager sign-off works natively. |
| **D23** | **Blind cycle counts with automatic recount.** `OPERATOR` submits `counted_qty` without seeing `system_qty`. If `abs(variance) / max(system_qty, 1) * 100 > count.recount_variance_pct` on Round 1, automatically spawn a Round 2 `COUNT` task that enforces `claimed_by !== round1_counter_id` (`COUNTER_MUST_DIFFER`). |
| **D24** | **Pick-only bin freeze with SLA timer.** When a Picker reports an exception at a bin, set `bins.pick_frozen = 1` (excludes bin from `v_available_stock`), auto-reroute the stop to an alternate bin if available, and auto-create a high-priority `COUNT` floor task with a `15 min` SLA timer. Unresolved exceptions after `exception.escalate_min` set `escalated = 1` on the Manager Control Tower. |
| **D25** | **Tote lifecycle.** `FREE -> IN_USE -> AWAITING_PACK -> PACKING -> FREE` (plus `QUARANTINED`). Seed `TOTE-001` through `TOTE-030`. |
| **D26** | **Single DB path architecture.** In Phase 0, verify whether routes live in Gateway, Engine 3, or both. All new domain logic (`postLedger`, `appendAudit`, floor flows) must execute against `warehouse.db` in one atomic transaction without split-brain writes. |

---

# PART D: GLOBAL CONVENTIONS

## D.1 Migrations
- Location: `migrations/warehouse/NNN_name.sql`.
- Because we strictly use the 4 existing roles (`MANAGER`, `OPERATOR`, `PICKER`, `STAFF`), `users` in `001_core.sql` **already has the exact role CHECK constraint** (`role IN ('MANAGER', 'OPERATOR', 'PICKER', 'STAFF')`). Do **NOT** drop/rebuild `users` in `010`; use safe `ALTER TABLE users ADD COLUMN ...` statements!
- When a table `CHECK` constraint must be expanded (`orders` in `016`, `pick_exceptions` in `018`), use the SQLite table rebuild recipe:
  1. Outside transaction: `PRAGMA foreign_keys = OFF;`
  2. Inside `BEGIN IMMEDIATE ... COMMIT`:
     - `CREATE TABLE x_new (...);`
     - `INSERT INTO x_new (...) SELECT ... FROM x;`
     - `DROP TABLE x;`
     - `ALTER TABLE x_new RENAME TO x;`
     - Recreate all indexes, triggers, and views (`v_available_stock`) that reference `x`.
     - Verify `PRAGMA foreign_key_check;` returns 0 rows.
  3. Re-enable `PRAGMA foreign_keys = ON;`.

| Planned Migration File | Phase | Content |
|---|---|---|
| `010_roles_users.sql` | P1 | `ALTER TABLE users ADD COLUMN` for `badge_id`, `pin_hash`, `zones`, `shift`, `failed_pin_attempts`, `locked_until`; unique index on `badge_id` |
| `011_system_config.sql` | P1 | `system_config`, `job_runs`, seed all `REF-6` keys |
| `012_audit_chain.sql` | P3 | `audit_log` hash columns (`seq`, `prev_hash`, `row_hash`), `audit_head`, immutability triggers, `order_events` |
| `013_products_ext.sql` | P4 | `ALTER TABLE products ADD COLUMN` for `barcode`, `weight_g`, `volume_cc`, `fragile`, `temp_zone`, `abc_class`, `shelf_life_days`, `price_paise`, `compat_group` |
| `014_ledger.sql` | P4 | `lots`, `ledger_entries`, `location_balances`, immutability + balance + non-negative triggers, `inventory.lot_id` |
| `015_totes_missions.sql` | P5 | `totes` (`TOTE-001..030`), `missions` lease/tote/priority/version columns, `pick_stops` 3-step scan columns, `floor_tasks` |
| `016_orders_rebuild.sql` | P6 | Rebuild `orders` to add `PACKING`, `DISPATCHED` to status CHECK and SLA/timestamp/version columns |
| `017_packing_dispatch.sql` | P6 | `pack_sessions`, `pack_scans`, `dispatch_slots` (`D-1..D-8`), `dispatch_handovers`, `packing_records.session_id` |
| `018_exceptions_adjustments.sql` | P7 | `bins.pick_frozen` columns, rebuild `pick_exceptions` for lifecycle states/SLA/escalation, `inventory_adjustments`, `count_results`, rebuild `v_available_stock` |
| `019_inbound.sql` | P8 | `purchase_orders`, `po_lines`, `receipt_lines` lot/expiry/QC/discrepancy columns, `rtv_records` |
| `020_replenish_reslot.sql` | P9 | `bins.zone_role`, `bins.min_qty`, `bins.max_qty`, `reslot_runs` |
| `021_floor_ux.sql` | P12 | `devices`, offline scan queue tracking |
| `022_reports.sql` | P11 | `shift_notes` |

## D.2 API conventions
- Standard error response JSON:
  `{ "error": "Human readable message", "code": "UPPER_SNAKE_CODE", "details"?: any }`
- HTTP Status mapping (`REF-5`): `400` bad input/missing idempotency/missing reason, `401` unauthenticated/expired, `403` forbidden/SoD violation, `404` not found/empty queue, `409` state/version/lease/lock conflict, `410` removed shortcut endpoint, `422` barcode mismatch or business-rule failure, `429` PIN rate limit.
- Every mutating route pipeline:
  `authMiddleware -> requirePerm('noun:verb') -> idempotencyMiddleware -> handler`
  Inside `handler`, run a single `runInTx(db, () => { ... })` (`BEGIN IMMEDIATE`) that atomically writes:
  1. Domain table mutation(s) (+ `postLedger` if stock moves),
  2. `outbox_events` row (`REF-7`),
  3. `order_events` row (whenever an `order_ref` is affected),
  4. `audit_log` row via `appendAudit()`.
- Timestamps: ISO-8601 UTC strings (`new Date().toISOString()`).

## D.3 Naming & Sequence Refs
- Permission strings: `noun:verb` (`REF-1`).
- Outbox & order event names: `noun.verb` (`REF-7`).
- Entity reference prefixes via `nextRef(db, prefix)` using `id_sequences`: `MSN-`, `ORD-`, `RCV-`, `PUT-`, `MOV-`, `ADJ-`, `FT-`, `EXC-`, `PO-`, `RSL-`, `RTV-`, `PCK-`, `LGR-`.

## D.4 Testing convention
- Test runner: `vitest` at workspace root (`pnpm test`).
- Directory structure: `tests/helpers/db.ts`, `tests/unit/*.test.ts`, `tests/integration/*.test.ts`.
- Integration tests use in-memory SQLite (`:memory:`) initialized with all `migrations/warehouse/*.sql` in sorted order via `makeTestDb()`.

## D.5 Frontend conventions
- Floor execution views live in `apps/web/src/pages/floor/`:
  - `PickerFloorPage.tsx` (`/floor/pick`)
  - `PackerFloorPage.tsx` (`/floor/pack` — includes Packing Bench tab & Dispatch Handover tab for `STAFF`)
  - `OperatorFloorPage.tsx` (`/floor/operator` — includes Inbound Dock, Putaway, Cycle Count, Relocation, Damage Flagging)
- Use `useCan(perm)` hook and `<RequirePerm perm="noun:verb">` route guard component.

---

# PART E: REFERENCE SECTIONS (READ ONLY WHEN A PHASE NAMES THEM)

## REF-1 Roles and permissions (Strictly 4 Roles)

Create `packages/shared/src/permissions.ts` with this exact definition:

```typescript
export const ROLES = ['MANAGER', 'OPERATOR', 'PICKER', 'STAFF'] as const;
export type Role = typeof ROLES[number];

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  MANAGER: [
    // Control Tower, KPIs & Read-Only Inspection
    'control:view', 'kpi:view', 'order:view', 'inventory:view', 'po:view',
    'dispatch:view', 'trace:view', 'rtv:view', 'floor:view_all', 'shift:note',
    // Order & Mission Management (Supervisory Only - No Physical Execution)
    'order:create', 'order:cancel', 'mission:reassign',
    // Exceptions, Cycle Count Triggers, Relocation Triggers & Dual-Control Approvals
    'exception:view', 'exception:resolve', 'exception:escalated',
    'count:request', 'relocate:request',
    'adjust:approve', 'adjust:approve_high',
    // Purchasing & Slotting Approval
    'po:create', 'reslot:simulate', 'reslot:approve', 'dispatch:regen_otp',
    // Audit & Integrity Verification
    'audit:view', 'audit:verify', 'audit:export',
    // Configuration, Users, Devices, Locks & Simulation
    'config:view', 'config:weights', 'config:thresholds',
    'user:manage', 'device:manage', 'lock:release', 'tote:manage', 'sim:run'
  ],
  OPERATOR: [
    // Inbound Dock, Putaway, Replenishment, Relocation, Blind Count & Damage Flag
    'inbound:receive', 'putaway:execute', 'relocate:execute', 'count:execute',
    'adjust:request', 'damage:flag', 'exception:raise', 'floortask:claim',
    'inventory:view', 'po:view', 'rtv:view', 'rtv:execute'
  ],
  PICKER: [
    // Outbound Floor Runner (Blind to total inventory)
    'mission:claim', 'pick:execute', 'putback:execute',
    'exception:raise', 'floortask:claim_pick'
  ],
  STAFF: [
    // Packing Bench, Quality Gate, Repick Trigger & Rider Dispatch Handover
    'pack:execute', 'repick:request', 'exception:raise',
    'dispatch:view', 'dispatch:handover', 'rto:process'
  ],
};

export function can(
  user: { permissions?: readonly string[]; role?: Role } | null | undefined,
  perm: string
): boolean {
  if (!user) return false;
  const list = user.permissions ?? (user.role ? ROLE_PERMISSIONS[user.role] : []);
  return list.includes(perm);
}
```

### Strict Action Ownership Matrix (Sanity Check)

| System Action / Operation | MANAGER | OPERATOR | PICKER | STAFF | Enforcement Rule |
|---|---|---|---|---|---|
| **Receive Inbound Stock** (`inbound:receive`) | No (View) | **Execute** | No | No | Dock scan + PO/QC match |
| **Putaway to Bin** (`putaway:execute`) | No (View) | **Execute** | No | No | Staged line + Target Bin scan |
| **Move Stock / Relocate** (`relocate:execute`) | Request Only (`relocate:request`) | **Execute** | No | No | Manager requests; Operator scans From/Item/To |
| **Blind Cycle Count** (`count:execute`) | Request Only (`count:request`) | **Execute** | No | No | Counter never sees `system_qty` |
| **Initiate Adjustment** (`adjust:request`) | No | **Execute** | Flag Exception Only | Flag Exception Only | Created via count variance or damage flag |
| **Approve Adjustment** (`adjust:approve`) | **Execute** | No (`SELF_APPROVAL_FORBIDDEN`) | No | No | High-value requires 2 distinct Managers (`manager1 != manager2`) |
| **Claim & Execute Picking** (`pick:execute`) | No (View) | No | **Execute** | No | Requires Bin + SKU + Tote scan |
| **Force-Unassign Stuck Mission** (`mission:reassign`) | **Execute** | No | No | No | Requires mandatory reason code |
| **Pack & Weigh Order** (`pack:execute`) | No (View) | No | No | **Execute** | Requires `PICKED` order + Tote scan + Item scans |
| **Trigger Repick** (`repick:request`) | No (View) | No | No | **Execute** | Spawns urgent REPICK task for Picker |
| **Rider OTP Handover** (`dispatch:handover`) | Regen OTP Only | No | No | **Execute** | Requires Slot scan + 4-digit Rider OTP |
| **Resolve Frozen Bin** (`exception:resolve`) | **Execute** | Recount Only | No | No | Requires count submitted & adjustments settled |
| **Tune Weights / Config / Users / Audit Verify** | **Execute** | No | No | No | Full audit trail on every change |

---

## REF-2 State machines (`packages/shared/src/stateMachine.ts`)

```typescript
export type Machine = 'ORDER' | 'MISSION' | 'PICK_STOP' | 'EXCEPTION' | 'ADJUSTMENT' | 'FLOOR_TASK';
export interface Transition {
  from: string;
  event: string;
  to: string;
  perms?: string[];
  guard?: string;
}
export function transition(machine: Machine, from: string, event: string): Transition;
export function allowedEvents(machine: Machine, from: string): string[];
```

### 1. ORDER Transitions
*(Note: In existing DB, newly created orders with reserved stock start at `RESERVED`. Map both `DRAFT` and `RESERVED` as eligible for assign or treat `RESERVED` as the pre-claim ready state.)*

| from | event | to | perms |
|---|---|---|---|
| `DRAFT`, `RESERVED` | `assign` | `ASSIGNED` | `mission:claim` / SYSTEM |
| `ASSIGNED` | `start_pick` | `PICKING` | `pick:execute` |
| `ASSIGNED`, `PICKING` | `unassign` | `RESERVED` | `mission:reassign` / SYSTEM |
| `PICKING` | `pick_complete` | `PICKED` | `pick:execute` |
| `PICKED` | `open_pack` | `PACKING` | `pack:execute` |
| `PACKING` | `pack_complete` | `PACKED` | `pack:execute` |
| `PACKING` | `repick` | `PICKING` | `repick:request` |
| `PACKED` | `handover` | `DISPATCHED` | `dispatch:handover` |
| `DRAFT`, `RESERVED`, `ASSIGNED`, `PICKING`, `PICKED`, `PACKING`, `PACKED` | `cancel` | `CANCELLED` | `order:cancel` |

### 2. MISSION Transitions
*(Uses existing `missions.status` values: `CREATED` = queued/unclaimed, `ASSIGNED` = claimed by picker, `IN_PROGRESS` = first bin scanned, `COMPLETED`, `CANCELLED`.)*

| from | event | to | perms |
|---|---|---|---|
| `CREATED` | `claim` | `ASSIGNED` | `mission:claim` |
| `ASSIGNED` | `first_scan` | `IN_PROGRESS` | `pick:execute` |
| `IN_PROGRESS` | `complete` | `COMPLETED` | `pick:execute` |
| `ASSIGNED`, `IN_PROGRESS` | `release` | `CREATED` | `mission:claim` / SYSTEM (lease expiry) |
| `ASSIGNED`, `IN_PROGRESS` | `force_unassign` | `CREATED` | `mission:reassign` |
| `CREATED`, `ASSIGNED`, `IN_PROGRESS` | `cancel` | `CANCELLED` | `order:cancel` / SYSTEM |

### 3. PICK_STOP Step Transitions (stored in `pick_stops.step`)

| from | event | to | perms |
|---|---|---|---|
| `PENDING` | `scan_bin` | `BIN_OK` | `pick:execute` |
| `BIN_OK` | `scan_item` | `ITEM_OK` | `pick:execute` |
| `ITEM_OK` | `scan_tote` | `DONE` | `pick:execute` |
| `PENDING`, `BIN_OK`, `ITEM_OK` | `short` | `SHORT` | `exception:raise` / SYSTEM |
| `PENDING`, `BIN_OK`, `ITEM_OK` | `reroute` | `CANCELLED` | `exception:raise` / SYSTEM |
| `PENDING` | `cancel` | `CANCELLED` | `order:cancel` / SYSTEM |

*(When `step` becomes `BIN_OK`, sync `pick_stops.status = 'IN_PROGRESS'`; when `DONE`, sync `status = 'CONFIRMED'`; when `SHORT` or `CANCELLED` via exception, sync `status = 'EXCEPTION'` so legacy queries stay consistent.)*

### 4. EXCEPTION Transitions (stored in `pick_exceptions.status`)

| from | event | to | perms |
|---|---|---|---|
| `OPEN` | `request_count` | `COUNT_REQUESTED` | `count:request` / SYSTEM |
| `COUNT_REQUESTED` | `count_done` | `COUNT_SUBMITTED` | `count:execute` / SYSTEM |
| `OPEN`, `COUNT_SUBMITTED` | `resolve` | `RESOLVED` | `exception:resolve` |

### 5. ADJUSTMENT Transitions (4-Role Dual-Manager Model)

| from | event | to | perms | guard |
|---|---|---|---|---|
| `PENDING_MANAGER` | `approve_low` | `APPLIED` | `adjust:approve` | `value < threshold && actor != requester` |
| `PENDING_MANAGER` | `approve_high_step1` | `PENDING_SECOND_MANAGER` | `adjust:approve` | `value >= threshold && actor != requester` |
| `PENDING_SECOND_MANAGER` | `approve_high_step2` | `APPLIED` | `adjust:approve_high` | `actor != requester && actor != manager1_id` |
| `PENDING_MANAGER`, `PENDING_SECOND_MANAGER` | `reject` | `REJECTED` | `adjust:approve` | `actor != requester` |
| `PENDING_MANAGER` | `cancel` | `CANCELLED` | `adjust:request` | `actor == requester` |

### 6. FLOOR_TASK Transitions

| from | event | to | perms |
|---|---|---|---|
| `OPEN` | `claim` | `CLAIMED` | `floortask:claim` / `floortask:claim_pick` |
| `CLAIMED` | `start` | `IN_PROGRESS` | `floortask:claim` / `floortask:claim_pick` |
| `CLAIMED`, `IN_PROGRESS` | `complete` | `DONE` | `count:execute` / `relocate:execute` / `putback:execute` / `pick:execute` |
| `CLAIMED`, `IN_PROGRESS` | `release` | `OPEN` | SYSTEM / owner |
| `OPEN`, `CLAIMED`, `IN_PROGRESS` | `cancel` | `CANCELLED` | SYSTEM / `order:cancel` / `exception:resolve` |

Floor task types & claim permissions:
- `COUNT`, `RELOCATE`, `REPLENISH`, `EXPIRY_REMOVE` -> require `floortask:claim` (`OPERATOR`)
- `PUTBACK`, `REPICK` -> require `floortask:claim_pick` (`PICKER`)

---

## REF-3 Ledger model (`services/engine3-inventory/src/ledger/postLedger.ts`)

### Location Key Formats
- `EXT` (external supplier/customer; the ONLY location allowed to have a negative balance)
- `STAGED:<rcvRef>` (inbound dock staging per receipt, e.g., `STAGED:RCV-20261112-0001`)
- `BIN:<binCode>` (storage shelf bin, e.g., `BIN:A-01-01`)
- `TOTE:<toteCode>` (plastic picking crate, e.g., `TOTE:TOTE-001`)
- `BENCH:<benchCode>` (packing table, e.g., `BENCH:BENCH-1`)
- `DISP:<slotCode>` (dispatch pigeonhole, e.g., `DISP:D-1`)
- `SHIPPED` (handed over to delivery rider)
- `QUAR` (damaged/expired quarantine holding)
- `LOST` (approved inventory write-off / shrinkage)

### `ledger_entries` Schema
```sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_ref TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  sku TEXT NOT NULL REFERENCES products(sku),
  lot_id TEXT NOT NULL REFERENCES lots(lot_id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  from_loc TEXT NOT NULL,
  to_loc TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'OPENING','RECEIVE','RECEIVE_REJECT','PUTAWAY','PICK','PACK',
    'STAGE_DISPATCH','HANDOVER','PUTBACK','RELOCATE','REPLENISH',
    'QUARANTINE','QUARANTINE_RELEASE','WRITE_OFF','ADJUST_IN','ADJUST_OUT','RTV','EXPIRE'
  )),
  ref_type TEXT,
  ref_id TEXT,
  order_ref TEXT,
  actor_id TEXT NOT NULL,
  reason_code TEXT,
  note TEXT,
  CHECK (from_loc <> to_loc)
);
```

### Standard Ledger Movements

| Event | `from_loc` | `to_loc` | `entry_type` |
|---|---|---|---|
| Opening stock backfill | `EXT` | `BIN:<code\|STAGED:rcv>` | `OPENING` |
| Receive good stock at dock | `EXT` | `STAGED:<rcvRef>` | `RECEIVE` |
| Receive damaged at dock | `EXT` | `QUAR` | `RECEIVE_REJECT` |
| Putaway to bin | `STAGED:<rcvRef>` | `BIN:<binCode>` | `PUTAWAY` |
| Pick into tote | `BIN:<binCode>` | `TOTE:<toteCode>` | `PICK` |
| Pack item scan onto bench | `TOTE:<toteCode>` | `BENCH:<benchCode>` | `PACK` |
| Pack complete to dispatch slot | `BENCH:<benchCode>` | `DISP:<slotCode>` | `STAGE_DISPATCH` |
| Rider OTP handover | `DISP:<slotCode>` | `SHIPPED` | `HANDOVER` |
| Mid-pick cancel put-back | `TOTE:<toteCode>` | `BIN:<binCode>` | `PUTBACK` |
| Bin-to-bin relocation / replenish | `BIN:<fromBin>` | `BIN:<toBin>` | `RELOCATE` / `REPLENISH` |
| Operator flags damaged in bin | `BIN:<binCode>` | `QUAR` | `QUARANTINE` |
| Packer flags damaged in tote | `TOTE:<toteCode>` | `QUAR` | `QUARANTINE` |
| Manager approves write-off | `QUAR` (or `BIN`) | `LOST` | `WRITE_OFF` |
| Manager rejects damage write-off | `QUAR` | `BIN:<binCode>` | `QUARANTINE_RELEASE` |
| Approved count surplus | `EXT` | `BIN:<binCode>` | `ADJUST_IN` |
| Approved count shortage | `BIN:<binCode>` | `LOST` | `ADJUST_OUT` |
| Return to vendor | `QUAR` | `EXT` | `RTV` |
| Expired stock removal | `BIN:<binCode>` | `QUAR` | `EXPIRE` |

### `postLedger(db, lines, actor, opts?)` Contract
1. Must be called inside an active transaction (`if (!db.inTransaction) throw new Error('postLedger requires active tx')`).
2. Validates `qty > 0` integer on every line.
3. Extracts all touched `BIN:<code>` and location keys, sorts them lexicographically (deadlock-free lock ordering, `D19`).
4. For any `to_loc` starting with `BIN:`, verifies single-lot-per-bin (`D8`): if `location_balances` for that `BIN:<code>` already has `qty > 0` for a different sku or different `lot_id`, throw `AppError('LOT_MIX', 422, 'Cannot mix different SKUs or lots in the same bin')`.
5. Inserts each `ledger_entries` row (the SQLite `AFTER INSERT` trigger updates `location_balances` and aborts with `NEGATIVE_BALANCE` if any non-`EXT` location drops `< 0`).
6. Updates projections (unless `opts?.skipProjection === true` during initial backfill):
   - Syncs `inventory` (`qty`, `sku`, `lot_id`, `storage_class`, `updated_at`) and `bins` (`current_qty`, `current_sku`, `status`: `'OCCUPIED'` when qty > 0 and was 'AVAILABLE', or `'AVAILABLE'` & current_sku = NULL when qty === 0).
   - Also inserts a corresponding row into `stock_movements` for bin-level movements so existing dashboard/movement widgets continue working seamlessly.

---

## REF-4 Barcode formats and normalisation (`packages/shared/src/barcodes.ts`)

Normalize every scan with `scan.trim().toUpperCase()`.

| Entity | Canonical Format | Also Accepted |
|---|---|---|
| Bin | `<binCode>` (e.g. `A-01-01`) | `BIN:<binCode>` |
| Product SKU | `products.barcode` (defaults to sku) | `products.sku`, `SKU:<sku>` |
| Tote | `TOTE-001` .. `TOTE-030` | `TOTE:TOTE-001` |
| Pack Bench | `BENCH-1` | `BENCH:BENCH-1` |
| Dispatch Slot | `D-1` .. `D-8` | `DISP:D-1` |
| Receipt | `RCV-...` | `ASN:...` |

Export helpers: `normalizeScan(s: string)`, `matchesBin(scan: string, binCode: string)`, `matchesSku(scan: string, product: { sku: string; barcode?: string | null })`, `matchesTote(scan: string, toteCode: string)`, `matchesSlot(scan: string, slotCode: string)`.

---

## REF-5 Error codes (`packages/shared/src/errors.ts`)

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_REQUIRED`, `TOKEN_EXPIRED` | 401 | Missing or expired JWT |
| `FORBIDDEN` | 403 | Missing permission (details: { required }) |
| `SOD_VIOLATION` | 403 | Order creator attempting to pick/pack own order |
| `ENDPOINT_REMOVED` | 410 | Removed legacy shortcut endpoint (`D11`) |
| `VALIDATION_FAILED` | 400 | Invalid request body or query params |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Mutating call missing idempotency header |
| `REASON_REQUIRED` | 400 | Missing valid `reasonCode` or `OTHER` note < 10 chars |
| `NOT_FOUND` | 404 | Entity not found |
| `NO_MISSION_AVAILABLE` | 404 | No queued missions available for picker's zones |
| `STATE_CONFLICT` | 409 | Illegal state transition |
| `VERSION_CONFLICT` | 409 | Optimistic lock (version) mismatch |
| `DUPLICATE` | 409 | Unique constraint conflict |
| `MISSION_NOT_OWNED` | 403 | Mission belongs to another picker |
| `MISSION_LEASE_EXPIRED` | 409 | Lease expired; re-claim mission |
| `ACTIVE_MISSION_EXISTS` | 409 | Picker already holds an active mission |
| `TOTE_IN_USE` | 409 | Scanned tote is not FREE |
| `SCAN_OUT_OF_SEQUENCE` | 422 | Wrong stop order or wrong scan step (BIN -> ITEM -> TOTE) |
| `SCAN_WRONG_BIN`, `SCAN_WRONG_ITEM`, `SCAN_WRONG_TOTE` | 422 | Barcode does not match expected target |
| `SCAN_QTY_EXCEEDS` | 422 | Picked qty outside 1..remaining |
| `ORDER_NOT_PICKED` | 409 | Attempted to open pack session before order is `PICKED` |
| `PACK_ITEM_NOT_IN_ORDER`, `PACK_ITEM_OVERSCAN`, `PACK_INCOMPLETE`, `WEIGHT_MISMATCH`, `SLOT_MISMATCH` | 422 | Packing bench verification errors |
| `OTP_INVALID` | 422 | Wrong or expired 4-digit rider OTP |
| `OTP_LOCKED` | 409 | Max OTP attempts exceeded; Manager must regenerate OTP |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Approver is the requester (or same manager on step 2) |
| `ADJ_NEEDS_SECOND_MANAGER` | 403 | High-value adjustment requires a second distinct Manager |
| `NEGATIVE_BALANCE` | 422 | Ledger movement would drop non-EXT location below 0 |
| `LOT_MIX` | 422 | Attempted to mix two different SKUs or lots in one bin |
| `BIN_LOCKED` | 409 | Bin has an active pick stop or shelf in maintenance |
| `BIN_FROZEN` | 409 | Bin is frozen under an active exception (`pick_frozen = 1`) |
| `COUNTER_MUST_DIFFER` | 409 | Round 2 blind recount must be claimed by a different Operator |
| `SHELF_LIFE_TOO_SHORT` | 422 | Inbound lot fails minimum remaining shelf-life % |
| `PO_MISMATCH` | 422 | Unapproved over-receipt against PO |
| `ORDER_CANCEL_NEEDS_PUTBACK` | 409 | Order has picked items in tote (before P10 put-back) |
| `DEVICE_NOT_ALLOWED` | 403 | Bound device mismatch |
| `RATE_LIMITED` | 429 | Too many failed PIN attempts |
| `LEDGER_IMMUTABLE`, `AUDIT_IMMUTABLE` | 500 | SQLite immutability trigger fired |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## REF-5b Reason codes (`packages/shared/src/enums.ts`)

```typescript
export const REASON_CODES = [
  'DAMAGED', 'EXPIRED', 'MISSING', 'FOUND', 'COUNT_VARIANCE',
  'THEFT_SUSPECTED', 'MISPLACED', 'SUPPLIER_SHORT', 'CUSTOMER_CANCEL',
  'STUCK_PICKER', 'OUT_OF_STOCK', 'BIN_FULL', 'BIN_BLOCKED', 'OTHER'
] as const;
```

Helper `requireReason(code?: string, note?: string)` throws `AppError('REASON_REQUIRED', 400, ...)` if code is not in `REASON_CODES` or if `code === 'OTHER'` and (`!note` or `note.trim().length < 10`).

---

## REF-6 `system_config` keys (seeded in `011_system_config.sql`)

Group `WEIGHT` requires `config:weights`; group `THRESHOLD` requires `config:thresholds` (both held by `MANAGER`).

| Key | Default | Type | Group | Description |
|---|---|---|---|---|
| `lease.mission_seconds` | 60 | int | THRESHOLD | Picker mission lease duration before auto-release |
| `lease.floor_task_seconds` | 120 | int | THRESHOLD | Floor task lease duration |
| `exception.recount_sla_min` | 15 | int | THRESHOLD | SLA minutes for Operator recount on frozen bin |
| `exception.escalate_min` | 15 | int | THRESHOLD | Minutes before unresolved exception flags escalated |
| `exception.rate_flag_per_100_picks` | 5 | float | THRESHOLD | Abnormal picker exception rate threshold per 100 picks |
| `adjust.high_threshold_inr` | 5000 | int | THRESHOLD | Adjustment value (INR) requiring 2nd distinct Manager approval |
| `count.recount_variance_pct` | 10 | float | THRESHOLD | Variance % triggering automatic Round 2 blind count |
| `count.require_second_counter` | true | bool | THRESHOLD | Enforce counter2 != counter1 on Round 2 count |
| `cycle.days.A` / `cycle.days.B` / `cycle.days.C` | 7 / 30 / 90 | int | THRESHOLD | Cycle count frequency days by ABC velocity class |
| `pack.weight_tolerance_pct` | 8 | float | THRESHOLD | Allowed % deviation on pack bench scale weight |
| `pack.bag_tare_g` | 40 | int | THRESHOLD | Standard delivery bag tare weight in grams |
| `dispatch.otp_max_attempts` | 3 | int | THRESHOLD | Max failed rider OTP attempts before lock |
| `inbound.min_shelf_life_pct` | 50 | float | THRESHOLD | Minimum remaining shelf life % required at dock |
| `fefo.min_days_to_expiry_at_pick` | 1 | int | THRESHOLD | Minimum days before expiry allowed for order allocation |
| `expiry.markdown_days` | 7 | int | THRESHOLD | Days before expiry to flag stock as expiring soon |
| `pick.strategy` | SINGLE | string | THRESHOLD | `SINGLE` or `BATCH` picking mode |
| `pick.batch_size` | 3 | int | THRESHOLD | Max orders grouped into one batch mission |
| `sla.promise_minutes` | 10 | int | THRESHOLD | Dark store customer delivery promise in minutes |
| `sla.pick_seconds_per_line` | 45 | int | THRESHOLD | Estimated seconds per order line for SLA slack |
| `reslot.benefit_effort_ratio` | 2.0 | float | THRESHOLD | Min saved walking distance / move effort ratio |
| `device.binding_required` | false | bool | THRESHOLD | Require registered `x-device-id` on floor mutations |
| `session.idle_minutes` | 10 | int | THRESHOLD | Floor session idle timeout |
| `alloc.w.velocity` / `zone` / `capacity` / `distance` / `weight_level` / `compat` | 30/20/15/15/10/10 | int | WEIGHT | Explainable shelf allocator scoring weights |

---

## REF-7 Event names (`outbox_events.topic` and `order_events.event`)

`order.created`, `order.assigned`, `order.unassigned`, `order.picking_started`, `order.picked`, `order.packing_opened`, `order.packed`, `order.dispatched`, `order.cancelled`, `mission.claimed`, `mission.released`, `mission.lease_expired`, `mission.force_unassigned`, `mission.completed`, `pick.bin_scanned`, `pick.item_scanned`, `pick.tote_scanned`, `pick.short`, `pick.rerouted`, `scan.rejected`, `pack.item_scanned`, `pack.item_flagged`, `pack.weighed`, `pack.completed`, `dispatch.handover`, `dispatch.otp_failed`, `exception.raised`, `exception.count_requested`, `exception.count_submitted`, `exception.resolved`, `exception.escalated`, `bin.frozen`, `bin.unfrozen`, `adjustment.requested`, `adjustment.approved_step1`, `adjustment.applied`, `adjustment.rejected`, `floortask.created`, `floortask.claimed`, `floortask.done`, `receipt.started`, `receipt.completed`, `putaway.confirmed`, `relocate.done`, `replenish.created`, `po.created`, `po.closed`, `lot.expiring`, `lot.expired`, `config.changed`, `audit.verified`.

---

## REF-8 Blind Floor DTOs (`packages/shared/src/dtos.ts` & `floorDtos.ts`)

```typescript
export interface PickerStopDTO {
  stopId: number;
  stopRef: string;      // formatted as `${missionRef}-S${stop_seq}` or stringified stop id
  seq: number;
  binCode: string;
  aisleLabel: string;
  sku: string;
  barcode: string;
  productName: string;
  qtyToPick: number;
  qtyPicked: number;
  step: 'PENDING' | 'BIN_OK' | 'ITEM_OK' | 'DONE' | 'SHORT';
  toteCode: string | null;
  orderRef: string;
}

export interface PickerMissionDTO {
  missionRef: string;
  orderRef: string;
  status: string;
  leaseExpiresAt: string | null;
  toteCode: string | null;
  totalStops: number;
  doneStops: number;
  stops: PickerStopDTO[];
}

export interface PackSessionDTO {
  sessionId: number;
  orderRef: string;
  toteCode: string;
  benchCode: string;
  status: 'OPEN' | 'COMPLETE' | 'ABORTED';
  lines: {
    sku: string;
    barcode: string;
    productName: string;
    expectedQty: number;
    scannedQty: number;
    flaggedQty: number;
  }[];
  expectedWeightG: number;
  actualWeightG: number | null;
  weightOk: boolean;
  canComplete: boolean;
}

export interface CountTaskDTO {
  taskRef: string;
  type: 'COUNT';
  binCode: string;
  sku: string;
  round: number;
  dueAt: string | null;
  // NEVER systemQty or variance
}
```

**Strictly Forbidden Keys anywhere inside PickerMissionDTO, PickerStopDTO, CountTaskDTO:**
`currentQty`, `current_qty`, `reservedQty`, `reserved_qty`, `availableQty`, `available_to_promise`, `atp_pickable`, `systemQty`, `system_qty`, `variance`, `customer`, `shipping_address`, `price_paise`.

---

# PART F: PHASES

## PHASE 0: Recon and baseline (MUST)
Goal: inspect the repository, record exact implementation facts in `RECON.md`, and verify the baseline runs. No source code changes in Phase 0 except creating tracking `.md` files and `scripts/smoke.ts`.

- **P0-T1 Tracking files.** Create at repo root:
  - `PROGRESS.md` containing a markdown checklist of every task ID (`- [ ] P0-T1` through `- [ ] P14-T4`) extracted via `grep -n "^- \*\*P[0-9]*-T" PRD.md`.
  - `RECON.md`, `BLOCKERS.md`, and `DECISIONS_NEW.md` with section headers.
- **P0-T2 Commands.** Read root `package.json` and `services/*/package.json` + `apps/web/package.json`. Record in `RECON.md` under `## Commands`: install, build, typecheck (`pnpm -r exec tsc --noEmit`), start-all, start-each, and test commands.
- **P0-T3 Answer B.4 & Architecture check.** Inspect `services/gateway/src/index.ts`, `services/gateway/src/routes/*`, and `services/engine3-inventory/src/index.ts`. Record in `RECON.md` with exact file paths and line numbers:
  - Whether `services/gateway` opens `data/warehouse.db` directly in its route handlers or proxies HTTP calls to `services/engine3-inventory` (or both), so all new routes follow the exact same pattern and share the same SQLite connection/transaction helper.
  - Where migrations are executed on startup (`db.ts`).
  - Exact idempotency header name in `services/gateway/src/middleware/idempotency.ts`.
  - How `inventory` and `bins` are updated when stock hits 0.
  - Exact seeded usernames and passwords in `data/seed.sql` or `db.ts`.
- **P0-T4 Route inventory.** Run `grep -rnE "Router|router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)" services/` and record the route table in `RECON.md`.
- **P0-T5 Baseline smoke test & DB backup.** Copy `data/warehouse.db` and `data/scheduler.db` to `data/backup-baseline/`. Write `scripts/smoke.ts` (using native fetch) that logs in as `manager1`, calls `/api/health`, `/api/dashboard`, `/api/orders`, `/api/inventory/summary`, and exits 0 on 200 OK.
- **CHECK:** `RECON.md` has complete answers with no TODO placeholders; `npx tsx scripts/smoke.ts` (or node) exits 0.

## PHASE 1: Foundations (MUST)
Read: `REF-1`, `REF-2`, `REF-4`, `REF-5`, `REF-5b`, `REF-6`.

- **P1-T1 Test harness.** Install vitest at root (`pnpm add -D -w vitest`) if not installed. Add `"test": "vitest run"` to root `package.json`. Create `tests/helpers/db.ts` exporting `makeTestDb()` which opens new `Database(':memory:')`, enables `PRAGMA foreign_keys = ON`, applies all `migrations/warehouse/*.sql` in sorted filename order, and returns `db`. Also export `seedMinimal(db)` creating test users (`manager1`, `manager2`, `operator1`, `operator2`, `picker1`, `picker2`, `staff1`), 2 products (`SKU-001`, `SKU-002`), 1 shelf (`S-01`), and 3 bins (`A-01-01`, `A-01-02`, `A-01-03`).
- **P1-T2 Migration 010_roles_users.sql.** Since `users.role` in `001_core.sql` already checks `role IN ('MANAGER', 'OPERATOR', 'PICKER', 'STAFF')`, do NOT drop `users`. Add columns via idempotent migration logic (or standard `ALTER TABLE` statements executed once by the migration tracker):
  ```sql
  ALTER TABLE users ADD COLUMN badge_id TEXT;
  ALTER TABLE users ADD COLUMN pin_hash TEXT;
  ALTER TABLE users ADD COLUMN zones TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE users ADD COLUMN shift TEXT NOT NULL DEFAULT 'MORNING' CHECK(shift IN ('MORNING','EVENING','NIGHT'));
  ALTER TABLE users ADD COLUMN failed_pin_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN locked_until TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_users_badge ON users(badge_id) WHERE badge_id IS NOT NULL;
  ```
- **P1-T3 Seed users for 4 roles (including 2 Managers and 2 Operators for Four-Eyes/Blind Recount).** In the database seed logic, ensure these active accounts exist (password `Warehouse#2026` hashed with bcrypt, PIN `1111` hashed with bcrypt):
  - `manager1` (`MANAGER`, badge `BDG-MGR-01`), `manager2` (`MANAGER`, badge `BDG-MGR-02`)
  - `operator1` (`OPERATOR`, badge `BDG-OPR-01`), `operator2` (`OPERATOR`, badge `BDG-OPR-02`)
  - `picker1` (`PICKER`, badge `BDG-PCK-01`, zones `["A","B"]`), `picker2` (`PICKER`, badge `BDG-PCK-02`, zones `["A","B","C"]`), `picker3` (`PICKER`, badge `BDG-PCK-03`, zones `[]`)
  - `staff1` (`STAFF`, badge `BDG-STF-01`), `staff2` (`STAFF`, badge `BDG-STF-02`)
- **P1-T4 Migration 011_system_config.sql.** Create tables `system_config` (`REF-6` schema) and `job_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL CHECK(status IN ('OK','ERROR')), detail TEXT)`. Seed all keys from `REF-6` using `INSERT OR IGNORE`.
- **P1-T5 Shared library (packages/shared).**
  - Create `packages/shared/src/permissions.ts` (`REF-1` 4-role map + `can()`).
  - Create `packages/shared/src/stateMachine.ts` (`REF-2` transition tables + `transition()`, `allowedEvents()`, `StateError`).
  - Create `packages/shared/src/barcodes.ts` (`REF-4` normalizer and matchers).
  - Create `packages/shared/src/errors.ts` (`AppError`, `ERROR_STATUS_MAP` for `REF-5`, and `requireReason()` for `REF-5b`).
  - Update `packages/shared/src/enums.ts` with `REASON_CODES` and export everything from `packages/shared/src/index.ts`. Run build on `@dark-storage/shared`.
- **P1-T6 DB transaction, config & sequence helpers.** Create `runInTx<T>(db, fn: () => T): T` using `db.transaction(fn).immediate()`, set `db.pragma('busy_timeout = 5000')`, create `nextRef(db, prefix: string): string` using `id_sequences`, and create `getConfig(db, key)` / `setConfig(db, key, value, actorId)` with a 5-second in-memory cache. Expose `GET /api/config` (`requirePerm('config:view')`) and `PUT /api/config/:key` (`requirePerm('config:weights')` for grp === 'WEIGHT', `requirePerm('config:thresholds')` for grp === 'THRESHOLD').
- **P1-T7 Auth & permission middleware (services/gateway & services/engine3-inventory).**
  - Update `POST /api/auth/login` and `GET /api/auth/me` to return `{ token, user: { id, username, role, display_name, zones, shift }, permissions: ROLE_PERMISSIONS[user.role] }`.
  - In `services/gateway/src/middleware/rbac.ts`, add `requirePerm(perm: string)` that checks `can(req.user, perm)` and returns 403 `{ error: "Forbidden", code: "FORBIDDEN", details: { required: perm } }`. Keep legacy `rbacMiddleware` as a deprecated wrapper or replace all uses in Phase 2.
  - Ensure `errorHandler.ts` formats `AppError` and `StateError` into `{ error, code, details }` (`D.2`).
- **P1-T8 Unit tests.**
  - `tests/unit/permissions.test.ts`: verify all 4 roles (`MANAGER`, `OPERATOR`, `PICKER`, `STAFF`); assert `MANAGER` returns false for `inbound:receive`, `putaway:execute`, `relocate:execute`, `count:execute`, `adjust:request`, `pick:execute`, `pack:execute`, `dispatch:handover`; assert `OPERATOR` returns false for `pick:execute`, `pack:execute`, `adjust:approve`; assert `PICKER` returns false for `inventory:view`, `order:view`; assert `STAFF` returns true for `pack:execute` and `dispatch:handover`.
  - `tests/unit/stateMachine.test.ts`: test every valid transition in `REF-2` and verify 12 invalid transitions throw `StateError` (`STATE_CONFLICT`).
- **CHECK:** `pnpm test` passes; `GET /api/config` returns all seeded config keys; `POST /api/auth/login` includes `permissions[]`.

## PHASE 2: RBAC enforcement and removal of Manager execution powers (MUST)
Read: `REF-1`, `REF-5`.

### P2-ROUTES Permission Mapping Table
| Endpoint / Route Family | Required Permission | Notes |
|---|---|---|
| `GET /api/dashboard` | Authenticated (any role) | Returns role-appropriate summary |
| `GET /api/orders`, `GET /api/orders/:ref` | `order:view` | `MANAGER` only (Pickers/Operators/Staff use their floor queues) |
| `POST /api/orders` | `order:create` | `MANAGER` |
| `POST /api/orders/:ref/cancel` | `order:cancel` | `MANAGER` |
| `GET /api/inventory/*`, `GET /api/warehouse/*`, `GET /api/products/*` | `inventory:view` | `MANAGER`, `OPERATOR` |
| `POST /api/receipts` | `inbound:receive` | `OPERATOR` only (`MANAGER` removed!) |
| `GET /api/receipts*`, `GET /api/putaways*` | `inbound:receive` or `po:view` | `OPERATOR`, `MANAGER` |
| `POST /api/putaway`, `POST /api/placement/evaluate` | `putaway:execute` | `OPERATOR` only (`MANAGER` removed!) |
| `POST /api/inventory/relocate` | `relocate:execute` | `OPERATOR` only (`MANAGER` removed!) |
| `POST /api/inventory/bins/:code/status` | `exception:resolve` | `MANAGER` |
| `GET /api/missions`, `GET /api/missions/:ref` | `order:view` or own-mission (`pick:execute`) | Pickers only see own active mission via `/api/picker/mission` |
| `GET /api/exceptions` | `exception:view` | `MANAGER` |
| `POST /api/exceptions/:ref/resolve` | `exception:resolve` | `MANAGER` |
| `GET /api/packing/queue` | `pack:execute` or `dispatch:view` | `STAFF`, `MANAGER` |
| `GET /api/tasks*` | `control:view` | `MANAGER` |
| `POST /api/tasks/locks/release` | `lock:release` | `MANAGER` |
| `GET /api/audit*`, `GET /api/admin/integrity` | `audit:view` | `MANAGER` |

- **P2-T1 Guard all Gateway/Engine3 routes.** Apply `requirePerm(...)` to every route per `P2-ROUTES` above, including `GET` routes.
- **P2-T2 Remove Manager execution powers and return 410 ENDPOINT_REMOVED on D11 shortcuts.**
  Replace handlers for these 5 shortcut endpoints with `410 { error: 'Endpoint removed for Segregation of Duties', code: 'ENDPOINT_REMOVED', details: { replacement } }`:
  - `POST /api/orders/:ref/pack` -> replacement `/api/packing/open`
  - `POST /api/packing/:ref/pack` -> replacement `/api/packing/open`
  - `POST /api/pick-stops/:stopRef/confirm` -> replacement `/api/pick-stops/:stopRef/scan-bin`
  - `POST /api/inventory/bins/:code/recount` -> replacement `/api/floor-tasks/:ref/count`
  - `POST /api/orders/:ref/assign` -> replacement `/api/missions/claim-next`
- **P2-T3 Frontend permissions & route guards.**
  - Update `apps/web/src/stores/authStore.ts` to store `permissions: string[]` from login.
  - Create `apps/web/src/hooks/useCan.ts` (`useCan(perm: string): boolean`) and `apps/web/src/components/RequirePerm.tsx` (renders an industrial "403 — Segregation of Duties Restriction" card with a "Go to My Workspace" button when unauthorized).
  - Wrap every route in `apps/web/src/App.tsx` with `<RequirePerm perm="...">`.
  - Filter sidebar links in `AppShell.tsx` strictly using `useCan(...)`, never `role === '...'`.
  - Role home redirects on login:
    - `MANAGER` -> `/` (Control Tower Dashboard)
    - `OPERATOR` -> `/floor/operator` (fallback `/receiving` until P5/P7 creates `/floor/operator`)
    - `PICKER` -> `/floor/pick` (fallback `/picking` until P5 creates `/floor/pick`)
    - `STAFF` -> `/floor/pack` (fallback `/packing` until P6 creates `/floor/pack`)
- **P2-T4 Strip forbidden execution buttons from Manager UI.** In `ReceivingPage.tsx`, `InventoryPage.tsx`, `PickingPage.tsx`, `MissionDetailPage.tsx`, and `PackingPage.tsx`, gate all mutation forms/buttons with `useCan(...)` so `MANAGER` has strictly read-only inspection on Receiving, Putaway, Picking, and Packing pages, and remove buttons calling 410 endpoints.
- **P2-T5 Secure Demo Role Switcher (D17).**
  - Delete hardcoded `Warehouse#2026` passwords from `apps/web/src/components/AppShell.tsx`.
  - Add `POST /api/auth/dev-switch` `{ username }` in `services/gateway/src/routes/auth.ts` gated by `process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production'` (supports switching between manager1, manager2, operator1, operator2, picker1, staff1).
  - Render the navbar Role Switcher only when `import.meta.env.VITE_DEMO_MODE === 'true'`. Add `DEMO_MODE=true` and `VITE_DEMO_MODE=true` to `.env.example` and `.env`.
- **P2-T6 Integration test tests/integration/rbac.test.ts.** Verify across all 4 roles:
  - `MANAGER` gets 403 FORBIDDEN on `POST /api/receipts`, `POST /api/putaway`, `POST /api/inventory/relocate`.
  - `PICKER` gets 403 FORBIDDEN on `GET /api/orders`, `GET /api/inventory/summary`, `GET /api/audit`.
  - `OPERATOR` gets 403 FORBIDDEN on `GET /api/orders`, `POST /api/orders`.
  - `STAFF` gets 403 FORBIDDEN on `POST /api/receipts`, `POST /api/putaway`, `POST /api/orders`.
  - All 5 D11 endpoints return 410 ENDPOINT_REMOVED.
- **CHECK:** `pnpm test` passes; `grep -rn "Warehouse#2026" apps/web/src` returns empty; `apps/web` builds cleanly.

## PHASE 3: Hash-chained audit log and order events (MUST)
Read: `REF-7`.

- **P3-T1 Migration 012_audit_chain.sql.**
  - Add hash-chain columns to `audit_log`:
    ```sql
    ALTER TABLE audit_log ADD COLUMN seq INTEGER;
    ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
    ALTER TABLE audit_log ADD COLUMN row_hash TEXT;
    ALTER TABLE audit_log ADD COLUMN reason_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_seq ON audit_log(seq);
    ```
  - Create `audit_head`:
    ```sql
    CREATE TABLE IF NOT EXISTS audit_head (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_seq INTEGER NOT NULL,
      last_hash TEXT NOT NULL
    );
    INSERT OR IGNORE INTO audit_head (id, last_seq, last_hash) VALUES (1, 0, 'GENESIS');
    ```
  - Create immutability triggers on `audit_log`:
    ```sql
    CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
    BEFORE UPDATE ON audit_log
    WHEN OLD.row_hash IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
    END;
    ```
  - Create `order_events` with immutability triggers:
    ```sql
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref TEXT NOT NULL REFERENCES orders(ref) ON DELETE CASCADE,
      event TEXT NOT NULL,
      actor_id TEXT,
      actor_role TEXT,
      payload TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_order_events_ref ON order_events(order_ref, id);
    CREATE TRIGGER IF NOT EXISTS trg_order_events_no_update BEFORE UPDATE ON order_events BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_order_events_no_delete BEFORE DELETE ON order_events BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
    ```
- **P3-T2 Implement appendAudit and appendOrderEvent.**
  - Create `services/engine3-inventory/src/audit/appendAudit.ts` (or in the shared DB layer used by Gateway/Engine3 per `RECON.md`).
  - `appendAudit(db, { actorId, actorRole, action, entityType, entityId, details?, reasonCode? })`:
    - Reads `audit_head` (`last_seq`, `last_hash`).
    - Sets `seq = last_seq + 1`, `at = new Date().toISOString()`.
    - Computes canonical JSON string with sorted keys: `{ action, actor: actorId, at, details: detailsStr, entity_id: entityId, entity_type: entityType, reason_code: reasonCode ?? null, role: actorRole, seq }`.
    - Computes `row_hash = crypto.createHash('sha256').update(prev_hash + canonical).digest('hex')`.
    - Inserts into `audit_log` and updates `audit_head`.
  - Create `ensureAuditChain(db)` run once at service startup: backfills `seq`, `prev_hash`, `row_hash` for any pre-existing `audit_log` rows where `row_hash IS NULL` in `id ASC` order, then updates `audit_head`.
  - Create `appendOrderEvent(db, { orderRef, event, actorId, actorRole, payload })`.
- **P3-T3 Replace raw INSERT INTO audit_log writes.** Search `services/` for `audit_log` inserts and route them all through `appendAudit()`. Add `appendOrderEvent()` to existing order creation and cancellation flows.
- **P3-T4 Audit verification, export, and order timeline endpoints.**
  - `GET /api/audit` (`audit:view`): paginated list including `seq`, `prev_hash`, `row_hash`, `reason_code`.
  - `GET /api/audit/verify` (`audit:verify`): walks all rows from `seq = 1..last_seq`, recomputes `sha256(prev_hash + canonical)`, compares against `row_hash` and `audit_head`, logs `audit.verified`, and returns `{ ok: boolean, checked: number, brokenAtSeq: number | null, headHash: string }`.
  - `GET /api/audit/export` (`audit:export`): returns `text/csv` download of the audit chain.
  - `GET /api/orders/:ref/events` (`order:view`): returns chronological `order_events` list.
- **P3-T5 Web Audit Verification UI.** In `apps/web/src/pages/AdminPage.tsx` (Overview / Audit tab), display `seq` and truncated `row_hash` badge, add a "Verify Hash Chain Integrity" button (`useCan('audit:verify')`) that displays a green banner ("Cryptographic Chain Intact: N records verified, head SHA-256: ...") or red tamper alert ("TAMPER DETECTED at seq #N"), and an "Export CSV" button (`useCan('audit:export')`). Also display the Order Event Timeline on `OrderDetailPage.tsx`.
- **P3-T6 Integration test tests/integration/auditChain.test.ts.** Append 30 audit rows; verify `verifyAuditChain(db)` returns `{ ok: true, checked: 30, brokenAtSeq: null }`; assert `UPDATE audit_log SET details='hacked' WHERE seq=12` throws `AUDIT_IMMUTABLE`; drop `trg_audit_no_update` in test, mutate row 12, and assert `verifyAuditChain(db)` returns `{ ok: false, brokenAtSeq: 12 }`.
- **CHECK:** `pnpm test` passes; `GET /api/audit/verify` returns `ok: true`.

## PHASE 4: Append-only stock ledger (MUST)
Read: `REF-3`, `REF-4`, `REF-5`. Take a copy of `data/warehouse.db` before running Phase 4.

- **P4-T1 Migration 013_products_ext.sql.** Extend `products` with physical and slotting attributes:
  ```sql
  ALTER TABLE products ADD COLUMN barcode TEXT;
  ALTER TABLE products ADD COLUMN weight_g INTEGER NOT NULL DEFAULT 250;
  ALTER TABLE products ADD COLUMN volume_cc INTEGER NOT NULL DEFAULT 500;
  ALTER TABLE products ADD COLUMN fragile INTEGER NOT NULL DEFAULT 0 CHECK(fragile IN (0,1));
  ALTER TABLE products ADD COLUMN temp_zone TEXT NOT NULL DEFAULT 'AMBIENT' CHECK(temp_zone IN ('AMBIENT','CHILLED','FROZEN'));
  ALTER TABLE products ADD COLUMN abc_class TEXT NOT NULL DEFAULT 'B' CHECK(abc_class IN ('A','B','C'));
  ALTER TABLE products ADD COLUMN shelf_life_days INTEGER DEFAULT 180;
  ALTER TABLE products ADD COLUMN price_paise INTEGER NOT NULL DEFAULT 15000;
  ALTER TABLE products ADD COLUMN compat_group TEXT NOT NULL DEFAULT 'GENERAL';
  UPDATE products SET barcode = sku WHERE barcode IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_products_barcode ON products(barcode);
  ```
- **P4-T2 Migration 014_ledger.sql.**
  - Create `lots`:
    ```sql
    CREATE TABLE IF NOT EXISTS lots (
      lot_id TEXT PRIMARY KEY,
      sku TEXT NOT NULL REFERENCES products(sku),
      lot_code TEXT NOT NULL,
      mfg_date TEXT,
      expiry_date TEXT,
      po_ref TEXT,
      supplier TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_lots_sku_expiry ON lots(sku, expiry_date);
    ```
  - Create `ledger_entries` (exact schema in `REF-3`) and `location_balances`:
    ```sql
    CREATE TABLE IF NOT EXISTS location_balances (
      location_key TEXT NOT NULL,
      sku TEXT NOT NULL REFERENCES products(sku),
      lot_id TEXT NOT NULL REFERENCES lots(lot_id),
      qty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (location_key, sku, lot_id)
    );
    CREATE INDEX IF NOT EXISTS ix_loc_bal_key ON location_balances(location_key);
    ```
  - Add `lot_id` to `inventory`: `ALTER TABLE inventory ADD COLUMN lot_id TEXT;`
  - Create triggers on `ledger_entries`:
    - `trg_ledger_no_update` (`BEFORE UPDATE -> RAISE(ABORT, 'LEDGER_IMMUTABLE')`)
    - `trg_ledger_no_delete` (`BEFORE DELETE -> RAISE(ABORT, 'LEDGER_IMMUTABLE')`)
    - `trg_ledger_balance` (`AFTER INSERT`):
      - Upserts `location_balances` for `(NEW.from_loc, NEW.sku, NEW.lot_id)` subtracting `NEW.qty`.
      - Upserts `location_balances` for `(NEW.to_loc, NEW.sku, NEW.lot_id)` adding `NEW.qty`.
      - Checks `SELECT CASE WHEN NEW.from_loc <> 'EXT' AND (SELECT qty FROM location_balances WHERE location_key = NEW.from_loc AND sku = NEW.sku AND lot_id = NEW.lot_id) < 0 THEN RAISE(ABORT, 'NEGATIVE_BALANCE') END;`.
- **P4-T3 Implement postLedger.ts and backfillOpeningLedger.ts.**
  - Create `services/engine3-inventory/src/ledger/postLedger.ts` implementing `postLedger(db, lines, actor, opts)` per `REF-3`.
  - Map SQLite trigger errors `'NEGATIVE_BALANCE'` -> `AppError('NEGATIVE_BALANCE', 422, ...)` and `'Single SKU per bin violation'` / `'Bin capacity exceeded...'` to appropriate 422 `AppError`s.
  - Create `backfillOpeningLedger(db)` executed on startup after migrations:
    - If `SELECT COUNT(*) FROM ledger_entries` is 0:
      - Inside `runInTx`, for every row in `inventory` with `qty > 0`, ensure `LOT-OPEN-<sku>` exists in `lots`, set `inventory.lot_id = 'LOT-OPEN-' || sku`, and call `postLedger` (`EXT -> BIN:<bin_code>`, type `'OPENING'`, `{ skipProjection: true }`).
      - For every row in `receipt_lines` where `qty_received - qty_put_away > 0`, ensure `LOT-OPEN-<sku>` exists and call `postLedger` (`EXT -> STAGED:<receipt_ref>`, type `'OPENING'`, `{ skipProjection: true }`).
- **P4-T4 Rewire Receive, Putaway, and Relocate to postLedger.**
  - Update receiving (`POST /api/receipts`): create lot `LOT-<receipt_ref>-<sku>`, call `postLedger` (`EXT -> STAGED:<receipt_ref>`, type `'RECEIVE'`).
  - Update putaway (`POST /api/putaway`): call `postLedger` (`STAGED:<receipt_ref> -> BIN:<dest_bin>`, type `'PUTAWAY'`). Remove direct `INSERT`/`UPDATE inventory` and `UPDATE bins` SQL from the route/service handler (since `postLedger` updates the projection).
  - Update relocation (`POST /api/inventory/relocate`): call `postLedger` (`BIN:<from_bin> -> BIN:<to_bin>`, type `'RELOCATE'`).
- **P4-T5 Ledger query & reconciliation endpoints.**
  - `GET /api/ledger?sku=&location=&orderRef=&limit=` (`inventory:view`): returns `ledger_entries` ordered by `id DESC` + `location_balances` summary.
  - `GET /api/ledger/reconcile` (`inventory:view`): compares `inventory.qty` and `bins.current_qty` against `SUM(location_balances.qty)` for every `BIN:<code>` and checks that `SUM(location_balances.qty)` across all locations (including `EXT`) equals 0 per `(sku, lot_id)` (double-entry zero-sum invariant). Returns `{ ok: boolean, zeroSumOk: boolean, mismatches: [] }`.
- **P4-T6 Tests.**
  - `tests/unit/postLedger.test.ts`: test `EXT -> STAGED -> BIN -> TOTE`, test `NEGATIVE_BALANCE` rollback, test `LOT_MIX` rejection when putting a 2nd lot into an occupied bin, test `LEDGER_IMMUTABLE` on update/delete.
  - `tests/unit/noDirectStockWrites.test.ts`: scan all `.ts` files in `services/` (excluding `postLedger.ts` and `backfillOpeningLedger.ts`) and assert no active code runs `INSERT INTO inventory`, `UPDATE inventory SET qty`, or `UPDATE bins SET current_qty`.
  - `tests/unit/ledgerProperty.test.ts`: execute 200 randomized valid movements across 5 bins and 2 SKUs; after every step assert `reconcile(db).ok === true` and `reconcile(db).zeroSumOk === true`.
- **CHECK:** `pnpm test` passes; `GET /api/ledger/reconcile` returns `{ ok: true, zeroSumOk: true, mismatches: [] }`; `scripts/smoke.ts` passes.

## PHASE 5: Totes, claim, leases, floor tasks, 3-step picking (MUST)
Read: `REF-2` (`MISSION`, `PICK_STOP`, `FLOOR_TASK`), `REF-3`, `REF-4`, `REF-5`, `REF-8`.

- **P5-T1 Migration 015_totes_missions.sql.**
  - Create `totes`:
    ```sql
    CREATE TABLE IF NOT EXISTS totes (
      tote_code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE','IN_USE','AWAITING_PACK','PACKING','QUARANTINED')),
      mission_ref TEXT,
      order_ref TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
    Seed `TOTE-001` through `TOTE-030` with `INSERT OR IGNORE`.
  - Add columns to `missions`:
    ```sql
    ALTER TABLE missions ADD COLUMN claimed_at TEXT;
    ALTER TABLE missions ADD COLUMN lease_expires_at TEXT;
    ALTER TABLE missions ADD COLUMN last_heartbeat_at TEXT;
    ALTER TABLE missions ADD COLUMN tote_code TEXT;
    ALTER TABLE missions ADD COLUMN priority INTEGER NOT NULL DEFAULT 300;
    ALTER TABLE missions ADD COLUMN sla_due_at TEXT;
    ALTER TABLE missions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE missions ADD COLUMN batch_id TEXT;
    ALTER TABLE missions ADD COLUMN zone_code TEXT;
    ```
  - Add columns to `pick_stops`:
    ```sql
    ALTER TABLE pick_stops ADD COLUMN step TEXT NOT NULL DEFAULT 'PENDING' CHECK (step IN ('PENDING','BIN_OK','ITEM_OK','DONE','SHORT','CANCELLED'));
    ALTER TABLE pick_stops ADD COLUMN bin_scanned_at TEXT;
    ALTER TABLE pick_stops ADD COLUMN item_scanned_at TEXT;
    ALTER TABLE pick_stops ADD COLUMN tote_scanned_at TEXT;
    ALTER TABLE pick_stops ADD COLUMN lot_id TEXT;
    ALTER TABLE pick_stops ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
    UPDATE pick_stops SET step = 'DONE' WHERE status = 'CONFIRMED';
    ```
  - Create `floor_tasks`:
    ```sql
    CREATE TABLE IF NOT EXISTS floor_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_ref TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('COUNT','RELOCATE','REPLENISH','PUTBACK','REPICK','EXPIRY_REMOVE')),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','IN_PROGRESS','DONE','CANCELLED')),
      bin_code TEXT,
      dest_bin_code TEXT,
      sku TEXT,
      lot_id TEXT,
      qty INTEGER,
      order_ref TEXT,
      source_ref TEXT,
      priority INTEGER NOT NULL DEFAULT 300,
      due_at TEXT,
      assigned_to TEXT REFERENCES users(id),
      lease_expires_at TEXT,
      payload TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_floor_tasks_status_prio ON floor_tasks(status, priority ASC, due_at ASC);
    ```
- **P5-T2 Blind DTO mapper (floorDtos.ts) + Unit test.**
  - Create `services/engine3-inventory/src/dto/floorDtos.ts` exporting `toPickerMissionDTO(db, missionRow)`, `toPackSessionDTO(db, sessionRow)`, and `toCountTaskDTO(taskRow)` matching `REF-8` strictly.
  - Create `tests/unit/dto.test.ts` that passes full database rows (containing `current_qty`, `reserved_qty`, `customer`, `shipping_address`, `price_paise`, `system_qty`) into the mappers and recursively asserts that zero forbidden keys appear in the serialized JSON.
- **P5-T3 Self-claim mission endpoint (POST /api/missions/claim-next).**
  - Guard: `requirePerm('mission:claim')`.
  - In `runInTx`:
    - Check if caller already has a mission in `'ASSIGNED'` or `'IN_PROGRESS'` -> if so, throw `AppError('ACTIVE_MISSION_EXISTS', 409, 'You already have an active mission')`.
    - Select candidate missions with `status = 'CREATED'` ordered by `priority ASC`, `sla_due_at ASC`, `id ASC`. Filter by caller's zones (if user's zones array is non-empty, match the aisle/zone of the mission's stops; if empty `[]`, match any zone). Also enforce `order.created_by !== actor.id` (`SOD_VIOLATION`).
    - If none found -> throw `AppError('NO_MISSION_AVAILABLE', 404, 'No missions waiting in queue')`.
    - Call `transition('MISSION', 'CREATED', 'claim')` and `transition('ORDER', order.status, 'assign')`.
    - Run optimistic-locked update:
      `UPDATE missions SET status = 'ASSIGNED', picker_id = ?, claimed_at = ?, lease_expires_at = ?, last_heartbeat_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'CREATED'`
      If `changes !== 1`, throw `AppError('VERSION_CONFLICT', 409, 'Mission was just claimed by another picker')`.
    - Update `orders.status = 'ASSIGNED'`, write `appendOrderEvent` (`mission.claimed`), `outbox_events`, `appendAudit`, and return `toPickerMissionDTO(db, mission)`.
- **P5-T4 Heartbeat, release, force-unassign, and Lease Sweep Job.**
  - `POST /api/missions/:ref/heartbeat` (`pick:execute`, must be `picker_id === actor.id`): extends `lease_expires_at = now + lease.mission_seconds`.
  - `POST /api/missions/:ref/release` (`mission:claim`, owner): transitions `MISSION` back to `CREATED` and `ORDER` to `RESERVED` (if no stops are DONE) or keeps `ORDER` in `PICKING` (if partial progress exists), clears `picker_id` and `lease_expires_at`, preserves `tote_code` and completed `DONE` stops.
  - `POST /api/missions/:ref/force-unassign` (`mission:reassign`, `MANAGER` only): requires `{ reasonCode, note }` (`requireReason`), transitions mission back to `CREATED`, clears `picker_id` and lease, writes `mission.force_unassigned` event + audit.
  - Create `src/jobs/leaseSweep.ts` registered in `src/jobs/index.ts` (runs every 15s): finds missions (`status IN ('ASSIGNED','IN_PROGRESS')`) and floor_tasks (`status IN ('CLAIMED','IN_PROGRESS')`) where `lease_expires_at < now`, releases them back to `CREATED` / `OPEN`, logs `mission.lease_expired` outbox event, and records execution in `job_runs`.
- **P5-T5 Picker active mission & 3-Step Barcode Scan endpoints.**
  - `GET /api/picker/mission` (`pick:execute`): returns `toPickerMissionDTO` for the caller's active mission (`status IN ('ASSIGNED','IN_PROGRESS')`), or 404 `NO_MISSION_AVAILABLE`.
  - `POST /api/pick-stops/:stopRef/scan-bin` `{ scan }`, `POST /api/pick-stops/:stopRef/scan-item` `{ scan, qty }`, `POST /api/pick-stops/:stopRef/scan-tote` `{ scan }` (all `requirePerm('pick:execute')`, idempotency required):
    - Lookup stop by `:stopRef` (accept either numeric `pick_stops.id` or `${mission_ref}-S${stop_seq}`). Verify caller owns the mission (`MISSION_NOT_OWNED`) and `lease_expires_at >= now` (`MISSION_LEASE_EXPIRED`).
    - Verify this stop is the first stop in `stop_seq ASC` order whose `step` is not in `('DONE','SHORT','CANCELLED')` -> else throw `AppError('SCAN_OUT_OF_SEQUENCE', 422, 'Complete earlier stop first')`.
    - On wrong barcode (`!matchesBin`, `!matchesSku`, `!matchesTote`), record an audit entry and `order_events` row (`scan.rejected`) in a separate commit before throwing 422 `SCAN_WRONG_BIN` / `SCAN_WRONG_ITEM` / `SCAN_WRONG_TOTE`.
    - `scan-bin`: requires `step === 'PENDING'`; transitions stop step -> `'BIN_OK'`, status -> `'IN_PROGRESS'`. If mission is `'ASSIGNED'`, transitions mission -> `'IN_PROGRESS'` and order -> `'PICKING'`. Extends mission lease.
    - `scan-item`: requires `step === 'BIN_OK'`; validates qty is integer 1..qty_to_pick (`SCAN_QTY_EXCEEDS`); sets `qty_picked = qty`, step -> `'ITEM_OK'`. Extends mission lease.
    - `scan-tote`: requires `step === 'ITEM_OK'`. If `mission.tote_code` is null, verify scanned tote exists in `totes` with `status === 'FREE'` (`TOTE_IN_USE`), set `totes.status = 'IN_USE'`, `totes.mission_ref = mission.ref`, `totes.order_ref = mission.order_ref`, and `missions.tote_code = toteCode`. If `mission.tote_code` is already set, verify `matchesTote(scan, mission.tote_code)` (`SCAN_WRONG_TOTE`). Then:
      - Call `postLedger` (`BIN:<bin_code> -> TOTE:<tote_code>`, qty: `stop.qty_picked`, type: `'PICK'`, lotId: `inv.lot_id`).
      - Decrement `inventory.reserved_qty` by `stop.qty_picked` and mark matching reservations `'FULFILLED'`, update `order_lines.qty_picked`.
      - Set `stop.step = 'DONE'`, `stop.status = 'CONFIRMED'`, `missions.completed_stops += 1`.
      - If all stops of the mission are now in `('DONE','SHORT','CANCELLED')`:
        - Transition mission -> `'COMPLETED'`, order -> `'PICKED'`, `orders.picked_at = now`, and `totes.status = 'AWAITING_PACK'`.
      - Return `{ ok: true, step: updatedStep, mission: toPickerMissionDTO(db, mission) }`.
- **P5-T6 Generic Floor Tasks endpoints.**
  - `GET /api/floor-tasks?status=&type=` (authenticated; returns tasks matching caller's role permissions: `OPERATOR` sees `COUNT|RELOCATE|REPLENISH|EXPIRY_REMOVE`, `PICKER` sees `PUTBACK|REPICK`, `MANAGER` sees all with `floor:view_all`). For `COUNT` tasks, map through `toCountTaskDTO` so `system_qty` is never exposed.
  - `POST /api/floor-tasks/:ref/claim`, `POST /api/floor-tasks/:ref/heartbeat`, `POST /api/floor-tasks/:ref/release` with optimistic locking (`version`) and lease timer (`lease.floor_task_seconds`).
- **P5-T7 Web Picker Floor Screen (/floor/pick).**
  - Create `apps/web/src/pages/floor/PickerFloorPage.tsx` wrapped in `<RequirePerm perm="pick:execute">`.
  - Plain, high-contrast industrial PDA layout (no 3D canvas):
    - When no active mission: large "CLAIM NEXT ORDER MISSION" button (`POST /api/missions/claim-next`) + section showing claimable urgent REPICK / PUTBACK floor tasks.
    - When mission active: displays Mission Ref, Tote badge (`TOTE-001` or "Scan any FREE tote at Step 3"), Lease countdown timer (auto-heartbeats every 15s), Serpentine Progress bar (Stop X of Y), and the current active stop card showing Aisle & Bin Code (`A-01-01`), Product Name & SKU, and Quantity to Pick (`qtyToPick`) (never total bin qty).
    - 3-Step Visual Stepper (1. SCAN BIN -> 2. SCAN ITEM -> 3. SCAN TOTE) with an auto-focused barcode input form (Enter submits) and green/red feedback banner.
- **P5-T8 Tests.**
  - `tests/integration/pickFlow.test.ts`: full happy path from claim through 3 scans per stop -> mission `COMPLETED`, order `PICKED`, tote `AWAITING_PACK`, ledger balance in `TOTE:TOTE-001`, `reconcile(db).ok === true`. Also test wrong bin scan, wrong SKU scan, out-of-sequence stop scan, tote already `IN_USE`, and non-owner picker scan (403 `MISSION_NOT_OWNED`).
  - `tests/integration/claimRace.test.ts`: 20 concurrent picker claim calls against 5 queued missions -> exactly 5 succeed with distinct pickers, 15 fail cleanly (`NO_MISSION_AVAILABLE` or `VERSION_CONFLICT`), 0 duplicate assignments.
  - `tests/integration/lease.test.ts`: expire `lease_expires_at`, run `runLeaseSweep(db)`, assert mission returns to `CREATED` while preserving `tote_code` and `DONE` stops.
- **CHECK:** `pnpm test` passes; picker flow works end-to-end; `MANAGER` receives 403 on `/api/missions/claim-next` and `/api/pick-stops/*/scan-*`.

## PHASE 6: Packing bench and Staff dispatch handover (MUST)
Read: `REF-2` (`ORDER`), `REF-3`, `REF-4`, `REF-5`, `REF-8`.
*(With 4 roles, STAFF operates both the Packing Bench and the Dispatch Handover window.)*

- **P6-T1 Migration 016_orders_rebuild.sql.**
  - Rebuild `orders` using the Part D.1 recipe so `status` CHECK allows:
    `('DRAFT','RESERVED','ASSIGNED','PICKING','PICKED','PACKING','PACKED','DISPATCHED','COMPLETED','CANCELLED','PARTIALLY_FULFILLED','FAILED')`
  - Migrate any existing `'PARTIALLY_FULFILLED'` rows to `'PACKED'` and `'COMPLETED'` to `'DISPATCHED'`.
  - Include new columns on `orders`: `promised_at TEXT`, `sla_due_at TEXT`, `picked_at TEXT`, `packed_at TEXT`, `dispatched_at TEXT`, `version INTEGER NOT NULL DEFAULT 0`.
  - Verify `PRAGMA foreign_key_check` returns empty.
- **P6-T2 Migration 017_packing_dispatch.sql.**
  - Create `pack_sessions`, `pack_scans`, `dispatch_slots` (seed `D-1..D-8`), and `dispatch_handovers`:
    ```sql
    CREATE TABLE IF NOT EXISTS pack_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref TEXT NOT NULL REFERENCES orders(ref),
      tote_code TEXT NOT NULL REFERENCES totes(tote_code),
      bench_code TEXT NOT NULL DEFAULT 'BENCH-1',
      opened_by TEXT NOT NULL REFERENCES users(id),
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETE','ABORTED')),
      weight_g INTEGER,
      expected_weight_g INTEGER NOT NULL DEFAULT 0,
      weight_ok INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pack_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES pack_sessions(id) ON DELETE CASCADE,
      sku TEXT NOT NULL REFERENCES products(sku),
      qty INTEGER NOT NULL CHECK (qty > 0),
      kind TEXT NOT NULL CHECK (kind IN ('SCANNED','MISSING','DAMAGED')),
      lot_id TEXT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dispatch_slots (
      slot_code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE','OCCUPIED')),
      order_ref TEXT
    );

    CREATE TABLE IF NOT EXISTS dispatch_handovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref TEXT NOT NULL UNIQUE REFERENCES orders(ref),
      slot_code TEXT NOT NULL REFERENCES dispatch_slots(slot_code),
      otp_hash TEXT NOT NULL,
      otp_expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      rider_name TEXT,
      handed_by TEXT REFERENCES users(id),
      handed_at TEXT
    );
    ```
  - Seed `D-1..D-8` into `dispatch_slots`. Add `ALTER TABLE packing_records ADD COLUMN session_id INTEGER;`.
- **P6-T3 Open Pack Session (POST /api/packing/open).**
  - Guard: `requirePerm('pack:execute')` (`STAFF` only).
  - Body: `{ toteScan, benchCode?: string }`.
  - Find tote matching `toteScan`. Verify tote status is `'AWAITING_PACK'` (or `'PACKING'` if resuming own open session) and linked order has status === `'PICKED'` (`ORDER_NOT_PICKED`). Enforce SoD: `order.created_by !== actor.id` (`SOD_VIOLATION`).
  - Transition order `PICKED -> PACKING`, update `totes.status = 'PACKING'`, create `pack_sessions` row, log `order.packing_opened`, return `toPackSessionDTO(db, session)`.
- **P6-T4 Item-by-Item Scan & Flagging at Pack Bench.**
  - `GET /api/packing/sessions/:id` (`pack:execute`): returns `toPackSessionDTO`.
  - `POST /api/packing/sessions/:id/scan-item` `{ scan }` (`pack:execute`):
    - Match scanned barcode against order lines. If SKU not in order -> 422 `PACK_ITEM_NOT_IN_ORDER`. If `scannedQty + flaggedQty >= expectedQty` -> 422 `PACK_ITEM_OVERSCAN`.
    - Select lot in `TOTE:<toteCode>` from `location_balances` (earliest expiry first), call `postLedger` (`TOTE:<toteCode> -> BENCH:<benchCode>`, qty: 1, type: `'PACK'`), insert `pack_scans` (kind: `'SCANNED'`), log `pack.item_scanned`, return updated `PackSessionDTO`.
  - `POST /api/packing/sessions/:id/flag-item` `{ sku, qty, kind: 'MISSING' | 'DAMAGED', note }` (`pack:execute` + `repick:request`):
    - If `kind === 'DAMAGED'`, call `postLedger` (`TOTE:<toteCode> -> QUAR`, qty, type: `'QUARANTINE'`).
    - If `kind === 'MISSING'`, no ledger move from tote (or if tote balance still shows it, leave for count/investigation).
    - Insert `pack_scans` (kind), auto-create a high-priority (priority: 100) `REPICK` floor task in `floor_tasks` for `sku` and `qty`, log `pack.item_flagged`, return updated `PackSessionDTO`.
- **P6-T5 Scale Weight Check & Complete Pack (POST /api/packing/sessions/:id/weigh & /complete).**
  - `/weigh` `{ grams }`: computes expected = sum(scannedQty * product.weight_g) + `getConfig(db, 'pack.bag_tare_g')`. If expected === 0 or `abs(grams - expected) / expected * 100 <= getConfig(db, 'pack.weight_tolerance_pct')`, sets `weight_ok = 1`, `weight_g = grams`; else sets `weight_ok = 0` and throws 422 `WEIGHT_MISMATCH` with `{ expected, actual: grams }`.
  - `/complete` `{ slotScan, cartonType? }`:
    - Verify all lines have `scannedQty + flaggedQty === expectedQty` (`PACK_INCOMPLETE`) and `weight_ok === 1` (`WEIGHT_MISMATCH`).
    - Verify `slotScan` matches a `FREE` slot in `dispatch_slots` (`SLOT_MISMATCH`).
    - In `runInTx`:
      - For all `SCANNED` items on the bench, call `postLedger` (`BENCH:<benchCode> -> DISP:<slotCode>`, type: `'STAGE_DISPATCH'`).
      - Mark `dispatch_slots` status = `'OCCUPIED'`, `order_ref = order.ref`.
      - Free the tote: `totes.status = 'FREE'`, `mission_ref = NULL`, `order_ref = NULL`.
      - Transition order `PACKING -> PACKED`, set `orders.packed_at = now`.
      - Insert `packing_records` (`fulfilment_type` = anyFlagged ? `'PARTIAL'` : `'FULL'`, `tracking_number = 'TRK-' + Date.now()`).
      - Generate 4-digit Rider OTP (`String(crypto.randomInt(1000, 10000))`), store `otp_hash = sha256(otp + ':' + order.ref)` in `dispatch_handovers` with 60-minute expiry. (In `DEMO_MODE=true`, also store the plain OTP in an audit/demo metadata column or deterministic HMAC so `/api/dispatch/demo-otp/:orderRef` can display it during demos).
      - Return `{ ok: true, orderRef, slotCode, fulfilmentType }`.
- **P6-T6 Dispatch Queue & Rider OTP Handover (STAFF & MANAGER oversight).**
  - `GET /api/dispatch/queue` (`dispatch:view` — `STAFF` and `MANAGER`): lists `PACKED` orders waiting in `dispatch_slots` with `slot_code`, `packed_at`, `locked`, `attempts`.
  - `POST /api/dispatch/:orderRef/handover` `{ slotScan, otp, riderName }` (`requirePerm('dispatch:handover')` — `STAFF` only):
    - Verify order is `PACKED` and `matchesSlot(slotScan, handover.slot_code)` (`SLOT_MISMATCH`).
    - If `handover.locked === 1` -> throw 409 `OTP_LOCKED`.
    - Compare `sha256(otp.trim() + ':' + orderRef)` against `otp_hash`. On mismatch: increment `attempts` in a committed transaction, set `locked = 1` if `attempts >= getConfig(db, 'dispatch.otp_max_attempts')`, log `dispatch.otp_failed`, and throw 422 `OTP_INVALID`.
    - On match: call `postLedger` (`DISP:<slotCode> -> SHIPPED`, type: `'HANDOVER'`), set `dispatch_slots.status = 'FREE'`, `order_ref = NULL`, transition order `PACKED -> DISPATCHED`, set `orders.dispatched_at = now`, update `dispatch_handovers`, log `dispatch.handover` + `order.dispatched`.
  - `POST /api/dispatch/:orderRef/regen-otp` `{ reasonCode, note }` (`requirePerm('dispatch:regen_otp')` — `MANAGER` only): validates reason, generates fresh 4-digit OTP, resets `attempts = 0`, `locked = 0`.
  - `GET /api/dispatch/demo-otp/:orderRef` (`DEMO_MODE=true` only): returns `{ orderRef, otp }` so the presenter can simulate the delivery rider showing their phone OTP at the dispatch window.
- **P6-T7 Web Packing & Dispatch Floor Screen (/floor/pack).**
  - Create `apps/web/src/pages/floor/PackerFloorPage.tsx` (`STAFF` workspace) with 2 tabs:
    - **Packing Bench Tab** (`pack:execute`): Scan Tote input -> displays order lines with Scanned / Expected counters, Item Barcode Scan input, "Flag Damaged / Missing" buttons per line, Scale Weight (g) input + "Verify Weight" button, Target Dispatch Slot scan (`D-1..D-8`), and "Complete Pack & Stage for Rider" button.
    - **Dispatch Handover Tab** (`dispatch:handover`): Shows occupied `D-1..D-8` slots; selecting an order prompts for Dispatch Slot Scan, Rider Name, and 4-Digit Rider OTP (with a "Show Demo Rider OTP" helper pill when `VITE_DEMO_MODE === 'true'`).
- **P6-T8 Integration test tests/integration/packFlow.test.ts.**
  - Full chain: Receive -> Putaway -> Order -> Claim -> 3-Step Pick -> Open Pack -> Scan Items -> Weigh -> Complete Pack to D-1 -> Rider OTP Handover -> Order `DISPATCHED`, tote `FREE`, slot `FREE`, stock in `SHIPPED`, `reconcile(db).ok === true`.
  - Negative tests: pack non-PICKED order (409), wrong item (422), overscan (422), weight mismatch (422), 3 wrong OTPs -> 409 `OTP_LOCKED` -> Manager regen-otp unlocks -> valid OTP succeeds.
- **CHECK:** `pnpm test` passes; full inbound-to-dispatch happy path works across `operator1` -> `picker1` -> `staff1`.

## PHASE 7: Exception loop, blind counts, dual-control adjustments, quarantine, relocation (MUST)
Read: `REF-2` (`EXCEPTION`, `ADJUSTMENT`, `FLOOR_TASK`), `REF-3`, `REF-5`, `REF-5b`, `D21`–`D24`.

- **P7-T1 Migration 018_exceptions_adjustments.sql.**
  - Add freeze columns to `bins`:
    ```sql
    ALTER TABLE bins ADD COLUMN pick_frozen INTEGER NOT NULL DEFAULT 0 CHECK (pick_frozen IN (0,1));
    ALTER TABLE bins ADD COLUMN frozen_reason TEXT;
    ALTER TABLE bins ADD COLUMN frozen_at TEXT;
    ALTER TABLE bins ADD COLUMN frozen_exception_ref TEXT;
    ALTER TABLE bins ADD COLUMN last_counted_at TEXT;
    ```
  - Rebuild or extend `pick_exceptions` so it has: `status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COUNT_REQUESTED','COUNT_SUBMITTED','RESOLVED'))`, `escalated INTEGER NOT NULL DEFAULT 0`, `due_at TEXT`, `count_task_ref TEXT`, `order_ref TEXT`, `resolution_reason TEXT`.
  - Create `inventory_adjustments`:
    ```sql
    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adj_ref TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('COUNT_VARIANCE','DAMAGE_WRITE_OFF','EXPIRY_WRITE_OFF','RTV')),
      status TEXT NOT NULL DEFAULT 'PENDING_MANAGER' CHECK (status IN ('PENDING_MANAGER','PENDING_SECOND_MANAGER','APPLIED','REJECTED','CANCELLED')),
      bin_code TEXT REFERENCES bins(code),
      sku TEXT NOT NULL REFERENCES products(sku),
      lot_id TEXT REFERENCES lots(lot_id),
      delta_qty INTEGER NOT NULL CHECK (delta_qty <> 0),
      value_paise INTEGER NOT NULL DEFAULT 0,
      reason_code TEXT NOT NULL,
      note TEXT,
      requested_by TEXT NOT NULL REFERENCES users(id),
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      manager1_id TEXT REFERENCES users(id),
      manager1_at TEXT,
      manager2_id TEXT REFERENCES users(id),
      manager2_at TEXT,
      reject_reason TEXT,
      source_ref TEXT,
      version INTEGER NOT NULL DEFAULT 0
    );
    ```
  - Create `count_results`:
    ```sql
    CREATE TABLE IF NOT EXISTS count_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_ref TEXT NOT NULL REFERENCES floor_tasks(task_ref),
      bin_code TEXT NOT NULL REFERENCES bins(code),
      sku TEXT NOT NULL REFERENCES products(sku),
      counted_qty INTEGER NOT NULL CHECK (counted_qty >= 0),
      system_qty INTEGER NOT NULL,
      variance INTEGER NOT NULL,
      counted_by TEXT NOT NULL REFERENCES users(id),
      counted_at TEXT NOT NULL DEFAULT (datetime('now')),
      round INTEGER NOT NULL DEFAULT 1
    );
    ```
  - Rebuild `v_available_stock` (`DROP VIEW IF EXISTS v_available_stock; CREATE VIEW v_available_stock AS ...`) adding `b.pick_frozen` and requiring `b.pick_frozen = 0` in the `CASE WHEN ... THEN (i.qty - i.reserved_qty) ELSE 0 END AS atp_pickable` expression (`D24`).
- **P7-T2 Picker raises exception with instant bin freeze & automatic live re-routing (Flow B).**
  - `POST /api/pick-stops/:stopRef/report-exception` `{ exceptionType: 'SHORTAGE'|'DAMAGED'|'BIN_EMPTY'|'BARCODE_UNREADABLE', note }` (`requirePerm('exception:raise')`, mission owner):
    - In one `runInTx`:
      - Set `bins.pick_frozen = 1`, `bins.recount_required = 1`, `frozen_reason = exceptionType`, `frozen_at = now`, `frozen_exception_ref = excRef`.
      - Create `pick_exceptions` row with `status = 'COUNT_REQUESTED'`, `due_at = now + exception.recount_sla_min`.
      - Auto-create a high-priority (priority: 100) `COUNT` floor task for `bin_code` & `sku` (payload: `JSON.stringify({ round: 1, exceptionRef: excRef })`), link `count_task_ref`.
      - **Live Re-route Check:** Query `v_available_stock` for another bin with the same `sku`, `atp_pickable >= remainingQty`, `pick_frozen = 0`, and no active pick lock (prefer earliest lot expiry FEFO, then nearest shelf).
        - If alternate bin found: mark current stop `step = 'CANCELLED'`, `status = 'EXCEPTION'`; release remaining reservation on the frozen bin and create a new `ACTIVE` reservation on the alternate bin; insert a replacement `pick_stops` row immediately after the current stop (`stop_seq = stop.stop_seq + 1`, bumping subsequent stops' `stop_seq` by +1); log `pick.rerouted`.
        - If no alternate bin found: mark current stop `step = 'SHORT'`, `status = 'EXCEPTION'`, release unpicked reservation on the frozen bin, and log `pick.short` (if all stops of the mission are now DONE/SHORT/CANCELLED, complete the mission so packing can proceed as partial or cancel if 0 items picked).
      - Log `exception.raised`, `bin.frozen`, `floortask.created` outbox events and audit. Return `{ ok: true, rerouted: boolean, newBinCode: string | null, mission: toPickerMissionDTO(db, mission) }`.
- **P7-T3 Blind Cycle Count execution (POST /api/floor-tasks/:ref/count).**
  - Guard: `requirePerm('count:execute')` (`OPERATOR` only).
  - Body: `{ binScan, countedQty }`.
  - Verify task is `CLAIMED` by caller, `type === 'COUNT'`, and `matchesBin(binScan, task.bin_code)` (`SCAN_WRONG_BIN`).
  - If `round === 2` and `getConfig(db, 'count.require_second_counter')`: verify caller is not the `counted_by` user from Round 1 (409 `COUNTER_MUST_DIFFER`, also checked at `/claim`).
  - Compute `system_qty` from `SUM(location_balances.qty)` for `BIN:<bin_code>` and `sku`. Compute `variance = countedQty - system_qty`. Insert `count_results`.
  - Complete the `floor_tasks` row (`status = 'DONE'`), set `bins.last_counted_at = now`.
  - **Variance handling:**
    - If `variance === 0`: if linked to an exception, transition exception `COUNT_REQUESTED -> COUNT_SUBMITTED`.
    - If `variance !== 0`:
      - Compute `variancePct = Math.abs(variance) / Math.max(system_qty, 1) * 100`.
      - If `round === 1 && variancePct > getConfig(db, 'count.recount_variance_pct')`: automatically create a Round 2 `COUNT` floor task (payload: `{ round: 2, round1CounterId: actor.id, round1Qty: countedQty, exceptionRef }`) and keep exception in `COUNT_REQUESTED`.
      - Otherwise (Round 2 completed, or Round 1 within threshold): transition linked exception to `COUNT_SUBMITTED` and automatically create an `inventory_adjustments` row (`kind: 'COUNT_VARIANCE'`, `status: 'PENDING_MANAGER'`, `delta_qty: variance`, `value_paise: Math.abs(variance) * product.price_paise`, `reason_code: 'COUNT_VARIANCE'`, `requested_by: actor.id`, `source_ref: exceptionRef || task.task_ref`).
  - Return `{ ok: true, taskRef: task.task_ref, status: 'DONE', nextStep: ... }` (**NEVER return system_qty or variance in the response**, `D23`).
- **P7-T4 Four-Eyes Dual-Control Adjustments API (MANAGER 1 & MANAGER 2).**
  - `POST /api/adjustments/request` `{ binCode, sku, deltaQty, reasonCode, note }` (`requirePerm('adjust:request')` — `OPERATOR` only): validates reason (`requireReason`), creates `PENDING_MANAGER` adjustment.
  - `POST /api/inventory/damage-flag` `{ binCode, qty, note }` (`requirePerm('damage:flag')` — `OPERATOR` only): verifies qty <= unreserved bin qty, calls `postLedger` (`BIN:<binCode> -> QUAR`, qty, type: `'QUARANTINE'`), and creates a `PENDING_MANAGER` adjustment (`kind: 'DAMAGE_WRITE_OFF'`, `delta_qty: -qty`, `reason_code: 'DAMAGED'`, `requested_by: actor.id`).
  - `GET /api/adjustments?status=` (`adjust:approve` or `audit:view`): lists adjustments with `value_paise`, `requested_by`, `manager1_id`, `manager2_id`.
  - `POST /api/adjustments/:ref/approve` `{ note }` (`requirePerm('adjust:approve')` — `MANAGER` only):
    - Guard 1: If `adj.requested_by === actor.id` -> throw 403 `SELF_APPROVAL_FORBIDDEN`.
    - Check threshold: `const isHighValue = adj.value_paise >= getConfig(db, 'adjust.high_threshold_inr') * 100`.
    - If `adj.status === 'PENDING_MANAGER'` and `isHighValue`:
      - Transition `PENDING_MANAGER -> PENDING_SECOND_MANAGER`, set `manager1_id = actor.id`, `manager1_at = now`, log `adjustment.approved_step1`, and return `{ ok: true, status: 'PENDING_SECOND_MANAGER' }`.
    - If `adj.status === 'PENDING_SECOND_MANAGER'`:
      - Verify `actor.id !== adj.manager1_id` -> else throw 403 `SELF_APPROVAL_FORBIDDEN` ("Second approver must be a different Manager").
      - Transition `PENDING_SECOND_MANAGER -> APPLIED`, set `manager2_id = actor.id`, `manager2_at = now`.
    - If `adj.status === 'PENDING_MANAGER'` and `!isHighValue`:
      - Transition `PENDING_MANAGER -> APPLIED`, set `manager1_id = actor.id`, `manager1_at = now`.
    - When transitioning to `APPLIED`, post the ledger movement in the same transaction:
      - `DAMAGE_WRITE_OFF` or `EXPIRY_WRITE_OFF`: `postLedger` (`QUAR -> LOST`, qty: `Math.abs(adj.delta_qty)`, type: `'WRITE_OFF'`).
      - `COUNT_VARIANCE` with delta_qty < 0: `postLedger` (`BIN:<bin_code> -> LOST`, qty: `Math.abs(adj.delta_qty)`, type: `'ADJUST_OUT'`).
      - `COUNT_VARIANCE` with delta_qty > 0: `postLedger` (`EXT -> BIN:<bin_code>`, qty: `adj.delta_qty`, type: `'ADJUST_IN'`).
  - `POST /api/adjustments/:ref/reject` `{ reasonCode, note }` (`requirePerm('adjust:approve')`):
    - Guard: `actor.id !== adj.requested_by` (`SELF_APPROVAL_FORBIDDEN`), `requireReason(reasonCode, note)`.
    - If `adj.kind === 'DAMAGE_WRITE_OFF'`, restore quarantined stock back to the bin: `postLedger` (`QUAR -> BIN:<bin_code>`, qty: `Math.abs(adj.delta_qty)`, type: `'QUARANTINE_RELEASE'`).
    - Transition status -> `'REJECTED'`.
- **P7-T5 Manager Exception Resolution & Escalation Job.**
  - `POST /api/exceptions/:ref/request-count` `{ note }` (`count:request` — `MANAGER`): spawns a fresh `COUNT` task for the exception's bin.
  - `POST /api/exceptions/:ref/resolve` `{ resolution, reasonCode, note, unfreeze?: boolean }` (`exception:resolve` — `MANAGER`):
    - Validates `requireReason(reasonCode, note)`.
    - Checks that no `inventory_adjustments` linked to `source_ref = exc.ref` or `bin_code = exc.bin_code` are still in `PENDING_MANAGER` or `PENDING_SECOND_MANAGER` (409 `STATE_CONFLICT`: "Settle pending inventory adjustments for this bin before resolving").
    - Transitions exception -> `'RESOLVED'`, clears `bins.pick_frozen = 0`, `bins.recount_required = 0`, `frozen_reason = NULL`, `frozen_exception_ref = NULL`, logs `bin.unfrozen` + `exception.resolved`.
  - Create `src/jobs/escalation.ts` (runs every 60s): marks `pick_exceptions` where `status <> 'RESOLVED'`, `escalated = 0`, and `age > exception.escalate_min` with `escalated = 1` and logs `exception.escalated`. Also expose `GET /api/exceptions/rates` (`exception:view`) showing picker exception rate per 100 picks and flagging rates > `exception.rate_flag_per_100_picks`.
- **P7-T6 Operator 3-Scan Relocation & assertBinFree Lock Check.**
  - Create helper `assertBinFree(db, binCode)` that throws 409 `BIN_FROZEN` if `bins.pick_frozen === 1` and 409 `BIN_LOCKED` if `bins.status IN ('BLOCKED','DAMAGED')` or if an active mission (`status IN ('ASSIGNED','IN_PROGRESS')`) has a non-completed stop on `binCode`. Call `assertBinFree` inside Putaway, Relocate, and Replenish.
  - `POST /api/relocations/request` `{ fromBin, toBin, sku, qty, reasonCode }` (`relocate:request` — `MANAGER`): validates target bin capacity/lot compatibility and creates a `RELOCATE` floor task for `OPERATOR`.
  - `POST /api/floor-tasks/:ref/relocate` `{ fromScan, itemScan, toScan }` (`relocate:execute` — `OPERATOR`): validates the 3 scans (`matchesBin(fromScan, task.bin_code)`, `matchesSku(itemScan, product)`, `matchesBin(toScan, task.dest_bin_code)`), runs `assertBinFree` on both bins, calls `postLedger` (`BIN:<from> -> BIN:<to>`, type: `'RELOCATE'`), marks task `DONE`.
- **P7-T7 Web UI for Exceptions, Dual-Control Adjustments & Operator Floor (/floor/operator).**
  - Create `apps/web/src/pages/floor/OperatorFloorPage.tsx` (`OPERATOR` workspace) with tabs for:
    - **Floor Tasks Queue** (`COUNT` / `RELOCATE` / `REPLENISH`): Claim task -> Blind Count form (Scan Bin + Enter Physical Qty, zero visibility into system qty) or 3-Scan Relocation form (Scan Source Bin -> Scan Item -> Scan Dest Bin).
    - **Inbound & Putaway** (links/embeds the dock receiving & allocator putaway workflow).
    - **Damage Flagging**: Scan Bin + SKU + Qty + Note -> moves to `QUAR` and submits write-off request.
  - Update `ExceptionsPage.tsx` (`MANAGER`) to show SLA timers, ESCALATED badges, linked count tasks, "Send Operator for Cycle Count", Pending Adjustments Approval Queue (with 1st Manager / 2nd Manager approval badges), and "Resolve & Unfreeze Bin".
  - Add "Report Exception (Missing / Damaged / Blocked)" button to `PickerFloorPage.tsx` that triggers `/report-exception` and immediately updates the picker's route on screen.
- **P7-T8 Integration tests.**
  - `tests/integration/exceptionLoop.test.ts`: full Flow B test: Picker reports `BIN_EMPTY` on A-01-01 -> A-01-01 is `pick_frozen = 1` -> stop automatically reroutes to A-01-02 -> Picker finishes picking from A-01-02 -> operator1 claims `COUNT` task on A-01-01 and submits 0 (blind) -> Round 2 `COUNT` task spawns -> operator1 blocked from claiming Round 2 (`COUNTER_MUST_DIFFER`) -> operator2 claims Round 2 and submits 0 -> `COUNT_VARIANCE` adjustment created -> manager1 approves -> manager1 resolves exception -> A-01-01 unfrozen (`pick_frozen = 0`), `reconcile(db).ok === true`.
  - `tests/integration/adjustments.test.ts`: test `SELF_APPROVAL_FORBIDDEN`; test high-value adjustment (>= ₹5000) requires manager1 (`PENDING_SECOND_MANAGER`) then manager2 (`APPLIED`), and manager1 cannot perform the second approval; test rejecting a `DAMAGE_WRITE_OFF` returns stock from `QUAR` to `BIN`.
- **CHECK:** `pnpm test` passes; complete Flow B works end-to-end across `picker1` -> `operator1` -> `operator2` -> `manager1` -> `manager2`.

## PHASE 8: Inbound: PO/ASN 3-way match, QC, lots/expiry, FEFO, RTV (SHOULD)
Read: `REF-1`, `REF-3`, `REF-5`, `REF-6`.

- **P8-T1 Migration 019_inbound.sql.**
  - Create `purchase_orders`, `po_lines`, and `rtv_records`:
    ```sql
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_ref TEXT NOT NULL UNIQUE,
      supplier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','CLOSED','CANCELLED')),
      expected_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS po_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_ref TEXT NOT NULL REFERENCES purchase_orders(po_ref) ON DELETE CASCADE,
      sku TEXT NOT NULL REFERENCES products(sku),
      expected_qty INTEGER NOT NULL CHECK (expected_qty > 0),
      received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
      damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0)
    );

    CREATE TABLE IF NOT EXISTS rtv_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rtv_ref TEXT NOT NULL UNIQUE,
      po_ref TEXT,
      supplier TEXT NOT NULL,
      sku TEXT NOT NULL REFERENCES products(sku),
      lot_id TEXT NOT NULL REFERENCES lots(lot_id),
      qty INTEGER NOT NULL CHECK (qty > 0),
      reason_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SHIPPED' CHECK (status IN ('PENDING','SHIPPED')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
  - Add columns to `receipts`: `po_ref TEXT`, `asn_ref TEXT`.
  - Add columns to `receipt_lines`: `lot_id TEXT`, `expiry_date TEXT`, `mfg_date TEXT`, `qty_damaged INTEGER NOT NULL DEFAULT 0`, `qc_status TEXT NOT NULL DEFAULT 'PASS' CHECK (qc_status IN ('PASS','REJECT_SHELF_LIFE','QUARANTINED'))`, `discrepancy_kind TEXT CHECK (discrepancy_kind IN ('NONE','SHORT','OVER','DAMAGED'))`.
- **P8-T2 PO Creation (MANAGER) & 3-Way Match Dock Receiving (OPERATOR).**
  - `POST /api/purchase-orders` `{ supplier, expectedAt, lines: [{ sku, expectedQty }] }` (`po:create` — `MANAGER`), `GET /api/purchase-orders` (`po:view`).
  - Upgrade `POST /api/receipts` (`inbound:receive` — `OPERATOR`):
    - Accepts `{ po_ref?, asn_ref?, supplier, lines: [{ sku, qty_received, qty_damaged?, lot_code?, mfg_date?, expiry_date? }] }`.
    - **Minimum Shelf-Life Rule:** If `expiry_date` and `mfg_date` (or `products.shelf_life_days`) are present, compute remaining shelf-life percentage: `(expiry - now) / totalShelfLife * 100`. If `< getConfig(db, 'inbound.min_shelf_life_pct')`, reject line with 422 `SHELF_LIFE_TOO_SHORT`.
    - **PO 3-Way Match:** If `po_ref` is given, verify `sku` is on `po_lines` and `received_qty + qty_received <= expected_qty` (else 422 `PO_MISMATCH`). Update `po_lines.received_qty` and transition `purchase_orders.status` to `'PARTIAL'` or `'CLOSED'`.
    - Create `lots` record (`lot_id`, `sku`, `lot_code`, `mfg_date`, `expiry_date`, `po_ref`, `supplier`).
    - Good units (`qty_received - qty_damaged`): `postLedger` (`EXT -> STAGED:<receipt_ref>`, type: `'RECEIVE'`).
    - Dock-damaged units (`qty_damaged > 0`): `postLedger` (`EXT -> QUAR`, type: `'RECEIVE_REJECT'`).
- **P8-T3 FEFO (First-Expiry-First-Out) Order Allocation.**
  - Update order reservation logic in `services/engine3-inventory/src/ledger/orderReservations.ts` (and `POST /api/orders`):
    - Join candidate bins from `v_available_stock` with `inventory` and `lots`.
    - Exclude lots where `expiry_date IS NOT NULL` and `(julianday(expiry_date) - julianday('now')) < getConfig(db, 'fefo.min_days_to_expiry_at_pick')`.
    - Order candidate bins by: `CASE WHEN lots.expiry_date IS NULL THEN 1 ELSE 0 END ASC, lots.expiry_date ASC, available_to_promise DESC`.
- **P8-T4 Return-to-Vendor (POST /api/rtv).**
  - Guard: `requirePerm('rtv:execute')` (`OPERATOR`).
  - Moves rejected/damaged stock in `QUAR` back to supplier: `postLedger` (`QUAR -> EXT`, type: `'RTV'`), inserts `rtv_records`.
  - `GET /api/rtv` (`rtv:view` — `MANAGER`, `OPERATOR`).
- **P8-T5 Operator Override of Recommended Putaway Bin (D21).**
  - In `POST /api/putaway`: if `selection_mode === 'MANUAL'` (Operator chose a different bin than Engine 2's top recommendation), require `{ reasonCode, note }` (`requireReason`, e.g. `BIN_FULL` or `BIN_BLOCKED`). If `reasonCode === 'BIN_FULL'` or `'BIN_BLOCKED'` on `recommended_bin`, automatically create a `COUNT` floor task on `recommended_bin` and log an audit entry.
- **P8-T6 Web Receiving & PO UI.** Add a Purchase Orders tab on `ReceivingPage.tsx` (`MANAGER` creates POs; `OPERATOR` selects an open PO to pre-fill Dock Intake with lot/expiry inputs and 3-way match badges) plus an RTV (Return to Vendor) tab for quarantined stock.
- **P8-T7 Integration test tests/integration/inboundFefo.test.ts.**
  - Test PO creation -> Receive rejecting a lot with < 50% shelf life (`SHELF_LIFE_TOO_SHORT`) -> Receive two valid lots of the same SKU with different expiry dates into two different bins -> Create customer order -> Assert reservation is placed on the bin with the earlier expiry date (FEFO) -> Test RTV from `QUAR -> EXT`.
- **CHECK:** `pnpm test` passes; FEFO and shelf-life rules verified.

## PHASE 9: Explainable allocator, replenishment, re-slotting what-if (SHOULD)
Read: `REF-6`.

- **P9-T1 Migration 020_replenish_reslot.sql.**
  - Add slotting/replenishment columns to `bins`:
    ```sql
    ALTER TABLE bins ADD COLUMN zone_role TEXT NOT NULL DEFAULT 'PICK_FACE' CHECK (zone_role IN ('PICK_FACE','RESERVE'));
    ALTER TABLE bins ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE bins ADD COLUMN max_qty INTEGER NOT NULL DEFAULT 50;
    ALTER TABLE bins ADD COLUMN temp_zone TEXT NOT NULL DEFAULT 'AMBIENT' CHECK (temp_zone IN ('AMBIENT','CHILLED','FROZEN'));
    ```
    Mark upper shelf levels (`level >= 4`) as `'RESERVE'` and lower levels (`level <= 3`) as `'PICK_FACE'`.
  - Create `reslot_runs`:
    ```sql
    CREATE TABLE IF NOT EXISTS reslot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_ref TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('SIMULATED','APPROVED','APPLIED')),
      moves_json TEXT NOT NULL,
      saved_distance_m REAL NOT NULL DEFAULT 0,
      effort_moves INTEGER NOT NULL DEFAULT 0,
      benefit_ratio REAL NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      approved_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
- **P9-T2 Upgrade Engine 2 Candidate Scorer with Explainable Breakdown.**
  - In `services/engine2-optimizer/src/placement/scorer.ts` (and `POST /api/placement/evaluate`):
    - Accept weights from `system_config` (`alloc.w.velocity`, `alloc.w.zone`, `alloc.w.capacity`, `alloc.w.distance`, `alloc.w.weight_level`, `alloc.w.compat`).
    - Enforce hard filters: bin not frozen/blocked/damaged, single-SKU & single-lot rule (`D8`), `storage_class` match (`HAZMAT`), `temp_zone` match (`AMBIENT`/`CHILLED`/`FROZEN`), free capacity >= qty, and incompatibility rule (do not place `compat_group = 'CHEMICAL'` on the same shelf bay adjacent to `compat_group = 'FOOD'`).
    - Compute sub-scores and return explainable string + breakdown object for each candidate bin:
      - `velocity`: A class items score highest in Golden Zone (close to PACK_STATION, level 1–2).
      - `zone`: `PICK_FACE` vs `RESERVE` match.
      - `capacity`: utilization fit after putaway.
      - `distance`: shortest path distance to `PACK_STATION`.
      - `weight_level`: heavy items (`weight_g >= 2000`) score highest on `level === 1` (heavy-at-bottom rule).
      - `compat`: bonus for matching category affinity.
      - `explanation`: e.g. "Bin A-01-01 chosen: score 89 (velocity +28, zone fit +20, capacity +14, distance +12, heavy-bottom +10, compat +5)".
- **P9-T3 Automatic Min/Max Replenishment (RESERVE -> PICK_FACE).**
  - Create `checkReplenishment(db, sku?)` (called after pick completion and via periodic job in `src/jobs/`):
    - When a `PICK_FACE` bin's `current_qty` for a SKU drops below `bins.min_qty` and there is a `RESERVE` bin holding the same SKU (with no open `REPLENISH` floor task for that destination bin), automatically create a `REPLENISH` task in `floor_tasks` (`bin_code`: reserveBin, `dest_bin_code`: pickFaceBin, `qty`: Math.min(reserveQty, pickFace.max_qty - pickFace.current_qty)).
    - Allow `OPERATOR` to complete `REPLENISH` tasks via `POST /api/floor-tasks/:ref/relocate` (uses `entry_type: 'REPLENISH'` in `postLedger`).
- **P9-T4 Re-slotting What-If Simulator & Approval (MANAGER).**
  - `POST /api/reslot/simulate` (`reslot:simulate` — `MANAGER`): analyzes last 100 order lines / SKU velocity (`abc_class = 'A'` sitting in distant bins vs `'C'` sitting near pack stations), computes proposed swap/relocation moves, estimates walking distance saved (meters per 100 orders) vs move effort, filters moves where `benefit_ratio >= getConfig(db, 'reslot.benefit_effort_ratio')`, stores a `SIMULATED` row in `reslot_runs`, and returns the simulation report.
  - `POST /api/reslot/:runRef/approve` (`reslot:approve` — `MANAGER`): transitions run to `'APPROVED'` and spawns `RELOCATE` floor tasks in `floor_tasks` for `OPERATOR`s to execute physically.
- **P9-T5 Web Explainable Allocator & Re-Slotting UI.**
  - Update `AllocationModal.tsx` to display the full visual score breakdown bar and human-readable explanation string for each candidate bin.
  - Add a "Dynamic Re-Slotting What-If" panel on `WarehousePage.tsx` (`MANAGER` only) to run simulations, inspect proposed bin moves and % walking distance saved, and click "Approve & Dispatch Relocation Tasks to Operators".
- **P9-T6 Integration test tests/integration/allocatorReplenish.test.ts.**
  - Verify heavy item (`weight_g = 5000`) ranks level = 1 above level = 4; verify `CHEMICAL` next to `FOOD` is rejected; verify picking a `PICK_FACE` bin below min_qty auto-creates a `REPLENISH` floor task from a `RESERVE` bin; verify reslot/simulate and approve generate `RELOCATE` floor tasks.
- **CHECK:** `pnpm test` passes; explainable breakdown renders in `AllocationModal`.

## PHASE 10: SLA-aware scheduling, mid-pick cancel put-back, batch picking (SHOULD)
Read: `REF-2`, `REF-3`, `REF-6`.

- **P10-T1 SLA-Aware Mission Priority & Load Balancing.**
  - When an order is created (`POST /api/orders`), set `promised_at = now + sla.promise_minutes` and `sla_due_at = promised_at`.
  - Compute estimated pick seconds: `estSeconds = lines.length * getConfig(db, 'sla.pick_seconds_per_line') + Math.round(distance_meters * 1.5)`.
  - Compute slack seconds: `(sla_due_at - now) - estSeconds`. Map slack to dynamic mission priority (slack < 180s -> 100 URGENT, slack < 360s -> 200 HIGH, else `order.priority`), and update a periodic background updater every 30s so orders approaching SLA breach automatically bubble to the top of `claim-next`.
- **P10-T2 Mid-Pick Order Cancellation with Put-Back Task (PUTBACK).**
  - Upgrade `POST /api/orders/:ref/cancel` `{ reasonCode, note }` (`order:cancel` — `MANAGER`):
    - Require `requireReason(reasonCode, note)`.
    - If order is in `DRAFT`, `RESERVED`, or `ASSIGNED` with 0 picked items: release reservations, cancel mission, free tote if any, transition order -> `'CANCELLED'`.
    - If order is in `PICKING`, `PICKED`, or `PACKING` and items have already been moved into `TOTE:<toteCode>` or `BENCH:<benchCode>`:
      - If in `BENCH`, move bench balances back to `TOTE:<toteCode>` or create PUTBACK tasks directly from current location.
      - Release any unfulfilled `ACTIVE` reservations.
      - Cancel active mission / abort open pack session.
      - Mark tote status `'IN_USE'` (held for putback) and create a high-priority `PUTBACK` floor task in `floor_tasks` for each `(sku, lot_id, qty)` sitting in `TOTE:<toteCode>` specifying the original source `bin_code` (or an allocator-recommended bin if the original bin is now full/frozen).
      - Transition order -> `'CANCELLED'`.
  - Add `POST /api/floor-tasks/:ref/putback` `{ toteScan, itemScan, binScan }` (`putback:execute` — `PICKER`):
    - Validates scans (`matchesTote`, `matchesSku`, `matchesBin`), calls `postLedger` (`TOTE:<toteCode> -> BIN:<binCode>`, type: `'PUTBACK'`), marks task `DONE`, and frees tote (`status = 'FREE'`) once `TOTE:<toteCode>` balance reaches 0.
- **P10-T3 Switchable Single vs Batch Picking (pick.strategy = 'BATCH').**
  - Add `POST /api/missions/claim-batch` (or handle inside `POST /api/missions/claim-next` when `getConfig(db, 'pick.strategy') === 'BATCH'`):
    - Groups up to `getConfig(db, 'pick.batch_size')` (3) queued missions in the same zone under a shared `batch_id = 'BCH-' + Date.now()`.
    - Merges their stops into a single serpentine route via Engine 2 TSP (`POST /api/routing/optimize-pick`) while keeping each stop's `order_ref` and assigning one distinct tote per order in the batch.
- **P10-T4 Integration test tests/integration/cancelPutback.test.ts.**
  - Start picking a 2-line order, complete Stop 1 (BIN -> TOTE-001), then Manager cancels the order (`CUSTOMER_CANCEL`) -> assert order is CANCELLED, Stop 2 reservation is released, a PUTBACK floor task exists for Stop 1's units in TOTE-001 -> Picker claims and executes `/putback` -> stock returns to BIN, TOTE-001 becomes FREE, `reconcile(db).ok === true`.
- **CHECK:** `pnpm test` passes; mid-pick cancellation leaves zero stranded stock in totes.

## PHASE 11: Manager Control Tower, KPIs, cycle-count scheduling, expiry sweep, shrinkage (SHOULD)
Read: `REF-6`.

- **P11-T1 Migration 022_reports.sql.**
  - Create `shift_notes`:
    ```sql
    CREATE TABLE IF NOT EXISTS shift_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift TEXT NOT NULL CHECK (shift IN ('MORNING','EVENING','NIGHT')),
      author_id TEXT NOT NULL REFERENCES users(id),
      author_name TEXT NOT NULL,
      note TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
- **P11-T2 Control Tower & Real-Time KPIs API (GET /api/control-tower & GET /api/kpis).**
  - Guard: `requirePerm('control:view')` / `requirePerm('kpi:view')` (`MANAGER`).
  - `GET /api/control-tower` returns:
    - **Live SLA Board:** active orders (`RESERVED..PACKED`) with `sla_due_at`, remaining seconds, `AT_RISK` (< 180s) and `BREACHED` (< 0s) flags.
    - **Zone Congestion Heatmap:** active pickers & open floor tasks per aisle/zone (A, B, C, etc.).
    - **Worker Active/Idle Roster:** all `PICKER`, `OPERATOR`, and `STAFF` users with their active mission/task/pack session, last heartbeat age, and shift.
    - **Aging Exception Queue:** open exceptions with age in minutes and escalated flag.
  - `GET /api/kpis` computes and returns:
    - **UPH** (Units Per Hour) per picker.
    - **Average Order Cycle Time** (`created_at -> dispatched_at` in minutes).
    - **Dock-to-Stock Time** (`receipts.received_at -> putaways.created_at` in minutes).
    - **Inventory Accuracy %** (`1 - abs(total_variance) / max(total_counted, 1)` from `count_results`).
    - **Perfect-Order Rate %** (FULL dispatched orders without exceptions / total dispatched orders).
    - **Bin Utilization %** & **SLA Breach %**.
    - **Shrinkage Report:** breakdown of `LOST` / `WRITE_OFF` / `ADJUST_OUT` ledger entries by bin, SKU, user, shift, and reason code (`value_paise`).
- **P11-T3 Automated ABC Cycle-Count Job & Daily Expiry Sweep Job.**
  - Create `src/jobs/cycleCountScheduler.ts`: checks occupied bins where `last_counted_at IS NULL` or older than `cycle.days.A` (7d), `cycle.days.B` (30d), or `cycle.days.C` (90d) based on `products.abc_class`, and creates up to 5 open `COUNT` floor tasks per sweep.
  - Create `src/jobs/expirySweep.ts`: checks `location_balances` (`BIN:*`) joined with `lots`:
    - Lots already expired (`expiry_date <= now`): creates an urgent `EXPIRY_REMOVE` floor task (priority: 100) and logs `lot.expired`.
    - Lots expiring within `expiry.markdown_days`: logs `lot.expiring` for the Control Tower alert feed.
  - Add `POST /api/floor-tasks/:ref/expiry-remove` `{ binScan, itemScan }` (`relocate:execute` / `damage:flag` — `OPERATOR`): moves expired stock `BIN -> QUAR` (type: `'EXPIRE'`) and creates a `PENDING_MANAGER` adjustment (kind: `'EXPIRY_WRITE_OFF'`).
- **P11-T4 Shift Handover Notes API & Control Tower Web UI.**
  - `GET /api/shift-notes` & `POST /api/shift-notes` `{ shift, note, pinned? }` (`shift:note` — `MANAGER`).
  - Upgrade `HomePage.tsx` (`MANAGER` Control Tower) to display the Live SLA Countdown Board, Worker Active/Idle Roster, Zone Congestion cards, the 7 Production KPIs, the Shrinkage Report table, and Shift Handover Notes.
- **P11-T5 Integration test tests/integration/kpisAndSweeps.test.ts.**
  - Seed an expired lot in a bin and an uncounted Class-A bin -> run `runExpirySweep(db)` and `runCycleCountScheduler(db)` -> assert `EXPIRY_REMOVE` and `COUNT` tasks are created -> execute expiry-remove -> verify `GET /api/kpis` and `GET /api/control-tower` return accurate metrics.
- **CHECK:** `pnpm test` passes; Control Tower dashboard displays live SLA and KPI cards.

## PHASE 12: Floor UX: scan input, scan simulator, PIN login, devices, offline queue (SHOULD)
Read: `REF-4`, `REF-6`, `D17`, `D18`.

- **P12-T1 Migration 021_floor_ux.sql.**
  - Create `devices`:
    ```sql
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      allowed_role TEXT NOT NULL CHECK (allowed_role IN ('OPERATOR','PICKER','STAFF')),
      zone_code TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT
    );
    ```
    Seed `PDA-PICK-01` (`PICKER`), `PDA-OPR-01` (`OPERATOR`), `BENCH-TERM-01` (`STAFF`).
- **P12-T2 Badge + 4-Digit PIN Fast Floor Login (POST /api/auth/pin-login).**
  - Accepts `{ badgeId, pin, deviceId? }`.
  - Looks up user by `badge_id`. Checks `locked_until > now` -> if locked, throws 429 `RATE_LIMITED`.
  - Verifies `pin` against `pin_hash` (bcrypt). On failure: increments `failed_pin_attempts`; if >= 5, sets `locked_until = now + 5 minutes`; throws 401 `AUTH_REQUIRED`.
  - If `getConfig(db, 'device.binding_required') === true`: verifies `deviceId` exists in `devices`, is `active = 1`, and `allowed_role === user.role` (403 `DEVICE_NOT_ALLOWED`).
  - Resets `failed_pin_attempts = 0` and returns the standard JWT + user + `permissions[]`.
  - Add a "Floor Badge + PIN Login" tab on `LoginPage.tsx` with a touch keypad and quick-fill demo badge chips when `VITE_DEMO_MODE === 'true'`.
- **P12-T3 Scanner-First Input Component & WebAudio Feedback.**
  - Create `apps/web/src/components/ScanBar.tsx`:
    - Keeps keyboard-wedge input focused (`autoFocus` + re-focuses on blur unless another input is clicked).
    - Plays a crisp WebAudio API high beep (880Hz, 120ms) + green flash on valid scan, and a low double-buzz (220Hz, 300ms) + red flash on 422 scan error.
- **P12-T4 Interactive Scan Simulator Floating Drawer (VITE_DEMO_MODE=true).**
  - Create `apps/web/src/components/ScanSimulatorDrawer.tsx` rendered on `/floor/*` pages when `import.meta.env.VITE_DEMO_MODE === 'true'`:
    - Displays context-aware 1-click barcode chips for the current screen:
      - On `/floor/pick`: shows chips for Current Target Bin (`A-01-01`), Current Target SKU (`SKU-...`), Free Totes (`TOTE-001`), plus a "Simulate Wrong Bin Scan" and "Simulate Wrong SKU Scan" chip to easily demo 422 rejection during viva/presentations!
      - On `/floor/pack`: shows chips for `AWAITING_PACK` totes, expected order SKUs, Exact Expected Scale Weight button, and Free Dispatch Slots (`D-1`).
      - On `/floor/operator`: shows chips for active Floor Task bins and SKUs.
- **P12-T5 Offline Mutation Queue for Floor Screens.**
  - Create a lightweight queue in `apps/web/src/api/offlineQueue.ts` backed by `localStorage` that buffers scan POST requests (preserving their UUID idempotency key) if `navigator.onLine === false` or network fetch fails, displays an "OFFLINE — N scans queued" pill in the header, and replays them in FIFO order upon reconnection.
- **P12-T6 Integration test tests/integration/pinAndDevices.test.ts.**
  - Test valid Badge + PIN login; test 5 wrong PIN attempts lock the account with 429 `RATE_LIMITED`; test `device.binding_required = true` blocks a `PICKER` logging in on `BENCH-TERM-01` (403 `DEVICE_NOT_ALLOWED`).
- **CHECK:** `pnpm test` passes; Scan Simulator Drawer lets a user click through the entire Picker, Packer, and Operator workflows without typing a single barcode manually.

## PHASE 13: Order simulator, concurrency bots, recall trace, event replay, tamper demo (WOW)
Read: `REF-1`, `REF-3`, `REF-7`.

- **P13-T1 Lot Recall Traceability (GET /api/trace/lot/:lotId).**
  - Guard: `requirePerm('trace:view')` (`MANAGER`).
  - Queries `lots` and `ledger_entries` for `:lotId` (or `lot_code`) and returns:
    - **Backward Trace (Origin):** Supplier, PO ref, Receipt ref, received timestamp, receiving Operator, initial QC status.
    - **Current In-Warehouse Holdings:** exact quantities currently sitting in `STAGED:*`, `BIN:*`, `TOTE:*`, `BENCH:*`, `DISP:*`, `QUAR`, `LOST`.
    - **Forward Trace (Customer Exposure):** every `order_ref`, customer name, pick/pack/dispatch timestamps, and current order status that received units from this lot, plus a 1-click "Quarantine All Remaining Bins of This Lot" action (`POST /api/trace/lot/:lotId/quarantine`).
- **P13-T2 Order Lifecycle Event Replay (GET /api/orders/:ref/replay).**
  - Guard: `requirePerm('order:view')` (`MANAGER`).
  - Merges `order_events`, `ledger_entries` (`WHERE order_ref = :ref`), and `audit_log` into a millisecond-ordered step-by-step playback array showing actor, role, from/to location, bin coordinates on the 2D floorplan, and order status at Step $k$.
  - Add an interactive Step-by-Step Replay Slider on `OrderDetailPage.tsx` that highlights the bin/tote/bench/dispatch slot on the SVG floorplan as you scrub through the order's history.
- **P13-T3 Order Wave Simulator & 20-Picker Concurrency Stress Proof (StressLabView.tsx).**
  - `POST /api/sim/order-wave` `{ preset: 'LUNCH_RUSH' | 'RAIN_SPIKE' | 'FLASH_SALE', count: number }` (`sim:run` — `MANAGER`): generates realistic multi-line customer orders, allocates stock via FEFO, and queues missions.
  - `POST /api/sim/concurrency-proof` `{ pickers: 20, missions: 10 }` (`sim:run` — `MANAGER`): runs an in-process concurrent simulation of 20 virtual pickers competing to claim missions and execute sorted-lock ledger moves simultaneously; returns a live proof report `{ totalAttempts, successfulClaims, versionConflictsCaught, duplicateClaims: 0, deadlocks: 0, ledgerReconciled: true, durationMs }`.
- **P13-T4 Interactive Audit Tamper & Detect Demo (DEMO_MODE=true).**
  - Add `POST /api/sim/tamper-audit` (`sim:run` + `DEMO_MODE=true`): temporarily disables `trg_audit_no_update`, modifies 1 character in a recent `audit_log` row's details, re-enables the trigger, so clicking "Verify Hash Chain Integrity" on the Audit page immediately lights up red with "TAMPER DETECTED at seq #N", alongside a `POST /api/sim/restore-audit` button that restores the original row and re-verifies green.
- **P13-T5 Web UI for Recall Trace & Stress Lab.**
  - Add a Recall Traceability tab on `InventoryPage.tsx` (`MANAGER`) to search any Lot ID, view the Backward -> Current Bins -> Forward Customer Orders graph, and quarantine remaining stock.
  - Wire `StressLabView.tsx` (`AdminPage.tsx` -> Stress Lab tab) to the Order Wave Simulator, 20-Picker Concurrency Proof, and Audit Tamper Demo buttons.
- **P13-T6 Integration test tests/integration/recallAndReplay.test.ts.**
  - Receive a lot -> split across 2 bins -> fulfill 2 customer orders from that lot -> call `/api/trace/lot/:lotId` -> assert both customer orders and remaining bin balances match 100% -> call `/api/orders/:ref/replay` -> assert chronological steps cover `order.created` through `order.dispatched`.
- **CHECK:** `pnpm test` passes; Recall Trace, Replay Slider, Wave Simulator, and Concurrency Proof work in UI.

## PHASE 14: End-to-end tests, seed data, documentation, and demo script (MUST)
Goal: polish the repository so it starts cleanly with rich demo data and passes all automated checks.

- **P14-T1 Rich, Realistic Dark Store Seed Data.**
  - Update the seed script (`data/seed.sql` / startup seeder) so a fresh start populates:
    - All 9 seeded accounts across the 4 roles (`manager1`, `manager2`, `operator1`, `operator2`, `picker1`, `picker2`, `picker3`, `staff1`, `staff2`) with badges and PIN `1111`.
    - 15+ realistic dark store SKUs across `AMBIENT`, `CHILLED`, `FROZEN`, and `HAZMAT` with barcodes, weights (`weight_g`), prices (`price_paise`), `abc_class` (A, B, C), and compatibility groups (`FOOD`, `CHEMICAL`, `GENERAL`).
    - Populated lots with staggered expiry dates (so FEFO is immediately visible), `TOTE-001..030`, `D-1..D-8` dispatch slots, 2 open Purchase Orders ready for dock receiving, 3 queued Missions ready for Picker claim, 1 `PICKED` order in `TOTE-005` ready at the Packing Bench, 1 `PACKED` order in `D-2` ready for Rider OTP handover, and 1 open Exception ready for Manager review.
    - Run `ensureAuditChain(db)` and `backfillOpeningLedger(db)` so `GET /api/audit/verify` and `GET /api/ledger/reconcile` both return `ok: true` immediately on boot.
- **P14-T2 Comprehensive End-to-End Integration Suite (tests/integration/e2eSoD.test.ts).**
  - Write a master integration test verifying:
    - All 4 roles (`MANAGER`, `OPERATOR`, `PICKER`, `STAFF`) enforce strict Segregation of Duties across every endpoint.
    - Complete Flow A (PO -> Dock Receive -> Explainable Putaway -> Customer Order FEFO -> Picker Claim & 3-Step Scan -> Staff Pack & Weigh -> Staff Rider OTP Handover).
    - Complete Flow B (Picker Missing Item Exception -> Instant Bin Freeze & Automatic Live Route Re-allocation -> Operator Blind Count Round 1 & Round 2 -> Dual-Manager High-Value Write-Off Approval -> Manager Exception Resolution & Bin Unfreeze).
    - Mid-pick order cancellation with `PUTBACK` task execution.
    - Cryptographic Audit Chain verification (`ok: true`) and Double-Entry Ledger Reconciliation (`ok: true`, `zeroSumOk: true`).
- **P14-T3 Update scripts/smoke.ts.**
  - Extend `scripts/smoke.ts` to log in as each of the 4 roles, verify `GET /api/audit/verify` (`ok: true`), verify `GET /api/ledger/reconcile` (`ok: true`), verify `MANAGER` gets 403 on physical execution endpoints, and exit 0.
- **P14-T4 Documentation (DEMO_SCRIPT.md).**
  - Create `DEMO_SCRIPT.md` at repo root with a step-by-step 5-minute viva/presentation walkthrough covering:
    - Role Switcher & PIN login demonstration.
    - Flow A Happy Path using the 1-Click Scan Simulator Drawer.
    - Flow B Exception, Live Re-route, Blind Recount, and Dual-Manager Write-Off Approval.
    - Explainable Allocator, Lot Recall Trace, 20-Picker Concurrency Proof, and Hash-Chained Audit Tamper detection.
- **CHECK:**
  - `pnpm -r exec tsc --noEmit` exits 0 across all packages/services/web.
  - `pnpm test` runs all unit and integration suites and exits 0.
  - `pnpm build` succeeds.
  - `npx tsx scripts/smoke.ts` exits 0.
  - All tasks `P0-T1` through `P14-T4` are ticked `- [x]` in `PROGRESS.md`.
