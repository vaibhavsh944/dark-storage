# Engine 3: Stock Tracking & Consistency Engine (DOMS) – Weekly Progress Report
**Dark Storage Shelf & Allocator Platform**

---

### Week 1 – Project Selection and Problem Understanding
- Finalized the project idea: Dark Storage Shelf and Allocator Platform for automated, lights-out warehouse operations.
- Studied inventory discrepancies in modern warehouses, including phantom stock, overselling, stock drift, and untracked manual movements.
- Identified the requirement for strict database ACID guarantees, transactional consistency, and double-entry bookkeeping principles.
- Discussed project objectives, inventory integrity metrics, and the architectural need for an immutable stock movement ledger.

---

### Week 2 – Requirement Analysis
- Identified the functional and non-functional requirements for the core inventory database subsystem.
- Divided the system into four decoupled engines: Request Coordination (E1), Smart Placement & Pick Optimization (E2), Stock Tracking & Consistency (E3), and Operations Dashboard & Gateway (E4).
- Defined the core responsibilities of E3: product registration, dock receiving, putaway confirmation, atomic stock reservations, pick execution, and discrepancy handling.
- Formulated the key functional requirements handled by E3: FR1 (Register Product), FR2 (Receive Inbound Stock), FR3 (Validate Stock), FR10 (Update Inventory Ledger), FR20 (Staged Goods), FR25 (Atomic Reservations), and FR30 (Pick Confirmations).

---

### Week 3 – System Architecture, Schema & Invariant Triggers
- Configured SQLite with high-concurrency settings: `PRAGMA journal_mode = WAL` (Write-Ahead Logging) and `PRAGMA foreign_keys = ON`.
- Created physical schema migrations: `001_core.sql`, `002_catalog_layout.sql`, and `003_inventory_ledger.sql` (`inventory`, `stock_movements`, `v_available_stock`).
- Engineered 4 database-level invariant triggers enforcing hard warehouse physical constraints:
  1. `inventory_capacity`: Aborts insert/update if `qty > bin.capacity`.
  2. `inventory_sku_mix`: Strictly rejects multiple SKUs in a single bin (single-SKU rule).
  3. `inventory_receivable`: Blocks stock writes into `BLOCKED` or `DAMAGED` bins.
  4. `inventory_storage_class`: Strictly prevents storing `HAZMAT` items on non-HAZMAT shelves.
- Verified that invalid writes raise SQL aborts (`RAISE(ABORT, ...)`), instantly rolling back the entire transaction.

---

### Week 4 – Inbound Receiving & Putaway Transaction Ledgering
- Created migrations `004_receiving.sql` and `005_putaway.sql` implementing two-phase inbound flow:
  - Phase 1 (Dock Intake): `POST /api/receipts` creates receipt records (`PENDING`) and stages line quantities (`STAGED`).
  - Phase 2 (Putaway): `POST /api/putaway` moves goods from dock to destination bin, updates `receipt_lines` to `COMPLETED`, and appends an immutable `PUTAWAY` record to `stock_movements`.
- Ensured zero direct updates to stock: all inventory modifications must be accompanied by a corresponding `stock_movements` record.
- Implemented Available-to-Promise (ATP) calculations via `v_available_stock` (`available_to_promise = qty - reserved_qty`).

---

### Week 5 – Outbound Order Reservations & Allocation Logic
- Created migration `006_orders.sql` defining `orders`, `order_lines`, and `reservations`.
- Implemented atomic stock reservation transactions:
  - When an order is placed, verified that `ATP >= ordered_qty`.
  - Atomically inserted an `ACTIVE` reservation and incremented `inventory.reserved_qty`.
  - Prevented overselling: if concurrent orders compete for remaining units, SQLite transaction isolation ensures only the first succeeds.
- Built order cancellation logic: automatically releases reserved stock back to ATP and marks reservations as `RELEASED`.

---

### Week 6 – Pick Execution, Packing & Transactional Outbox Pattern
- Created migrations `007_missions.sql`, `008_exceptions.sql`, and `009_packing.sql`.
- Implemented pick confirmation transactions (`POST /api/pick-stops/:stopRef/confirm`):
  - Decrements `inventory.qty` and `inventory.reserved_qty` simultaneously.
  - Decrements `bins.current_qty` and marks reservation as `FULFILLED`.
  - Records an immutable `PICK` movement in `stock_movements`.
  - Appends an event record into `outbox_events` in the *same* atomic database transaction.
- Implemented packing verification: orders transition to `PACKED` only after all stops are confirmed, creating permanent tracking records.

---

### Week 7 – Discrepancy Exception Handling & Audit Reconciliation
- Built the picking discrepancy reporting pipeline (`POST /api/pick-stops/:stopRef/exception`):
  - Pickers can flag `SHORTAGE`, `DAMAGED`, `BIN_EMPTY`, or `BARCODE_UNREADABLE`.
  - Automatically flags the bin with `recount_required = 1` to prevent further pick assignments.
- Implemented Manager cycle-counting and stock adjustments (`POST /api/inventory/bins/:code/recount`):
  - Reconciles physical count differences and logs explicit `ADJUSTMENT` movement records.
- Enforced Segregation of Duties (SoD): pickers can only report exceptions; only authorized managers can approve write-offs and adjustments.

---

### Week 8 – Validation, Database Integrity Audit and Closure
- Executed the comprehensive automated database integrity check suite (`GET /api/admin/integrity`):
  1. Negative stock check: 0 instances across all bins.
  2. Bin over-capacity check: 0 instances.
  3. Orphan reservation check: 0 unlinked reservations.
  4. Single-SKU violation check: 0 instances.
  5. Missing foreign key references: 0 instances.
- Validated complete business process: Inbound Receiving $\rightarrow$ Smart Putaway $\rightarrow$ Order Reservation $\rightarrow$ Pick Confirmation $\rightarrow$ Exception Recount $\rightarrow$ Packing.
- Completed database schema documentation, entity-relationship diagrams, trigger specifications, and presentation slides.

---

### Overall Progress
During the first eight weeks, Engine 3 (DOMS) progressed from baseline requirement gathering to a fully realized, transactional double-entry inventory ledger. Particular attention was given to Write-Ahead Logging (WAL), database-level invariant triggers (capacity, single-SKU, HAZMAT), atomic stock reservations, the Transactional Outbox pattern, and verified zero-drift audit reconciliation.
