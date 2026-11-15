# Engine 1: Storage Request & Resource Coordination Engine (SCE) – Weekly Progress Report
**Dark Storage Shelf & Allocator Platform**

---

### Week 1 – Project Selection and Problem Understanding
- Finalized the project idea: Dark Storage Shelf and Allocator Platform for automated, lights-out warehouse operations.
- Studied asynchronous concurrency problems in warehousing, such as wave allocation bottlenecks and conflicting inventory requests.
- Identified the need for an independent scheduling engine to coordinate background batch tasks, priority dispatching, and resource locking.
- Discussed project objectives, non-blocking asynchronous processing goals, and separation of scheduler duties from transactional inventory logic.

---

### Week 2 – Requirement Analysis
- Identified the functional and non-functional requirements for the asynchronous coordination subsystem.
- Divided the system into four decoupled engines: Request Coordination (E1), Smart Placement & Pick Optimization (E2), Stock Tracking & Consistency (E3), and Operations Dashboard & Gateway (E4).
- Defined the core responsibilities of E1: priority queuing, distributed resource locks, worker daemons, and job retry policies.
- Formulated the key functional requirements handled by E1: FR7 (Task Enqueueing), FR8 (Priority Dispatching), FR15 (Resource Locking), and FR32 (Exponential Backoff Retries).

---

### Week 3 – System Architecture and Engine Decomposition
- Studied the inter-engine communication architecture between Gateway (E4), Scheduler (E1), Optimizer (E2), and Ledger (E3).
- Defined the inputs for E1: task type (`PUTAWAY`, `ORDER_ALLOCATE`, `PICK_OPTIMIZE`, `RECOUNT_DISPATCH`), priority level, resource target, and payload parameters.
- Defined the outputs of E1: task ID, queue status, execution timestamps, error envelopes, and distributed lock tokens.
- Established a dedicated SQLite database (`scheduler.db`) to ensure zero-dependency local ACID persistence for queues and locks.

---

### Week 4 – Task Queue Design & Polling Mechanics
- Designed the database schema for asynchronous jobs: `tasks`, `locks`, `lock_tokens`, and `task_events`.
- Modeled the task lifecycle state machine: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `RETRYING`, and `CANCELLED`.
- Implemented an embedded polling mechanism using SQLite:
  `SELECT * FROM tasks WHERE status = 'QUEUED' AND run_after <= datetime('now') ORDER BY priority ASC, created_at ASC LIMIT 1`.
- Verified non-blocking task execution where heavy background jobs do not block user HTTP requests.

---

### Week 5 – Distributed Resource Locking & Concurrency Control
- Studied distributed mutual exclusion (Mutex) techniques to prevent two pickers or replenishment tasks from accessing the same shelf or bin.
- Implemented monotonic fencing tokens: each acquired lock increments a global sequence counter (`token = token + 1`) to prevent stale writes.
- Designed automatic Time-to-Live (TTL) lease mechanisms to automatically expire abandoned locks after 30 seconds.
- Built a background lease sweep worker that cleans up stale locks every 5 seconds.

---

### Week 6 – Worker Daemon & Fault Tolerance
- Built the worker execution loop daemon (`services/engine1-scheduler/src/queue/worker.ts`).
- Implemented exponential backoff retry logic: failed operations automatically retry after 1s, 2s, and 4s delays.
- Configured dead-letter tracking: tasks exceeding `max_attempts` (3 attempts) transition to `FAILED` and log an event in `task_events`.
- Integrated automated triggering of `PICK_OPTIMIZE` tasks upon the creation of new customer orders.

---

### Week 7 – Inter-Engine Coordination & Error Handling Design
- Designed the coordination flow where E1 calls E2 for TSP path optimization and then dispatches assignments to E3.
- Implemented error handling for downstream service timeouts and engine unavailability.
- Built REST monitoring endpoints: `GET /api/tasks`, `GET /api/tasks/locks`, and `POST /api/tasks/locks/release`.
- Studied failure cases such as engine crashes during job execution and verified automatic job recovery upon service restart.

---

### Week 8 – Validation, Performance and Documentation
- Benchmarked task enqueue latency: sub-2ms insertion time into SQLite task queue.
- Verified concurrent resource locking: tested simultaneous lock attempts on the same shelf location; verified zero double-allocations.
- Simulated downstream failures and verified that exponential backoff successfully recovered transient network drops.
- Completed full architectural documentation, API contracts, sequence diagrams, and presentation slides for faculty evaluation.

---

### Overall Progress
During the first eight weeks, Engine 1 (SCE) progressed from initial concurrency requirement analysis and SQLite queue schema design to a robust, fault-tolerant priority scheduler. Particular attention was given to monotonic fencing-token locks, distributed mutual exclusion on warehouse shelves, background worker execution loops, and automated exponential backoff retries.
