# Implementation Progress: Dark Store WMS Upgrade

## Phase 0: Recon and baseline (MUST)
- [x] P0-T1 Tracking files
- [x] P0-T2 Commands
- [x] P0-T3 Answer B.4 & Architecture check
- [x] P0-T4 Route inventory
- [x] P0-T5 Baseline smoke test & DB backup

## Phase 1: Foundations (MUST)
- [x] P1-T1 Test harness
- [x] P1-T2 Migration 010_roles_users.sql
- [x] P1-T3 Seed users for 4 roles
- [x] P1-T4 Migration 011_system_config.sql
- [x] P1-T5 Shared library (packages/shared)
- [x] P1-T6 DB transaction, config & sequence helpers
- [x] P1-T7 Auth & permission middleware
- [x] P1-T8 Unit tests

## Phase 2: RBAC enforcement and removal of Manager execution powers (MUST)
- [x] P2-T1 Guard all Gateway/Engine3 routes
- [x] P2-T2 Remove Manager execution powers and return 410 ENDPOINT_REMOVED on D11 shortcuts
- [x] P2-T3 Frontend permissions & route guards
- [x] P2-T4 Strip forbidden execution buttons from Manager UI
- [x] P2-T5 Secure Demo Role Switcher (D17)
- [x] P2-T6 Integration test tests/integration/rbac.test.ts

## Phase 3: Hash-chained audit log and order events (MUST)
- [x] P3-T1 Migration 012_audit_chain.sql
- [x] P3-T2 Implement appendAudit and appendOrderEvent
- [x] P3-T3 Replace raw INSERT INTO audit_log writes
- [x] P3-T4 Audit verification, export, and order timeline endpoints
- [x] P3-T5 Web Audit Verification UI
- [x] P3-T6 Integration test tests/integration/auditChain.test.ts

## Phase 4: Append-only stock ledger (MUST)
- [x] P4-T1 Migration 013_products_ext.sql
- [x] P4-T2 Migration 014_ledger.sql
- [x] P4-T3 Implement postLedger.ts and backfillOpeningLedger.ts
- [x] P4-T4 Rewire Receive, Putaway, and Relocate to postLedger
- [x] P4-T5 Ledger query & reconciliation endpoints
- [x] P4-T6 Tests

## Phase 5: Totes, claim, leases, floor tasks, 3-step picking (MUST)
- [x] P5-T1 Migration 015_totes_missions.sql
- [x] P5-T2 Blind DTO mapper (floorDtos.ts) + Unit test
- [x] P5-T3 Self-claim mission endpoint (POST /api/missions/claim-next)
- [x] P5-T4 Heartbeat, release, force-unassign, and Lease Sweep Job
- [x] P5-T5 Picker active mission & 3-Step Barcode Scan endpoints
- [x] P5-T6 Generic Floor Tasks endpoints
- [x] P5-T7 Web Picker Floor Screen (/floor/pick)
- [x] P5-T8 Tests

## Phase 6: Packing bench and Staff dispatch handover (MUST)
- [x] P6-T1 Migration 016_orders_rebuild.sql
- [x] P6-T2 Migration 017_packing_dispatch.sql
- [x] P6-T3 Open Pack Session (POST /api/packing/open)
- [x] P6-T4 Item-by-Item Scan & Flagging at Pack Bench
- [x] P6-T5 Scale Weight Check & Complete Pack (POST /api/packing/sessions/:id/weigh & /complete)
- [x] P6-T6 Dispatch Queue & Rider OTP Handover (STAFF & MANAGER oversight)
- [x] P6-T7 Web Packing & Dispatch Floor Screen (/floor/pack)
- [x] P6-T8 Integration test tests/integration/packFlow.test.ts

## Phase 7: Exception loop, blind counts, dual-control adjustments, quarantine, relocation (MUST)
- [x] P7-T1 Migration 018_exceptions_adjustments.sql
- [ ] P7-T2 Picker raises exception with instant bin freeze & automatic live re-routing (Flow B)
- [ ] P7-T3 Blind Cycle Count execution (POST /api/floor-tasks/:ref/count)
- [ ] P7-T4 Four-Eyes Dual-Control Adjustments API (MANAGER 1 & MANAGER 2)
- [ ] P7-T5 Manager Exception Resolution & Escalation Job
- [ ] P7-T6 Operator 3-Scan Relocation & assertBinFree Lock Check
- [ ] P7-T7 Web UI for Exceptions, Dual-Control Adjustments & Operator Floor (/floor/operator)
- [ ] P7-T8 Integration tests

## Phase 8: Inbound: PO/ASN 3-way match, QC, lots/expiry, FEFO, RTV (SHOULD)
- [ ] P8-T1 Migration 019_inbound.sql
- [ ] P8-T2 PO Creation (MANAGER) & 3-Way Match Dock Receiving (OPERATOR)
- [ ] P8-T3 FEFO (First-Expiry-First-Out) Order Allocation
- [ ] P8-T4 Return-to-Vendor (POST /api/rtv)
- [ ] P8-T5 Operator Override of Recommended Putaway Bin (D21)
- [ ] P8-T6 Web Receiving & PO UI
- [ ] P8-T7 Integration test tests/integration/inboundFefo.test.ts

## Phase 9: Explainable allocator, replenishment, re-slotting what-if (SHOULD)
- [ ] P9-T1 Migration 020_replenish_reslot.sql
- [ ] P9-T2 Upgrade Engine 2 Candidate Scorer with Explainable Breakdown
- [ ] P9-T3 Automatic Min/Max Replenishment (RESERVE -> PICK_FACE)
- [ ] P9-T4 Re-slotting What-If Simulator & Approval (MANAGER)
- [ ] P9-T5 Web Explainable Allocator & Re-Slotting UI
- [ ] P9-T6 Integration test tests/integration/allocatorReplenish.test.ts

## Phase 10: SLA-aware scheduling, mid-pick cancel put-back, batch picking (SHOULD)
- [ ] P10-T1 SLA-Aware Mission Priority & Load Balancing
- [ ] P10-T2 Mid-Pick Order Cancellation with Put-Back Task (PUTBACK)
- [ ] P10-T3 Switchable Single vs Batch Picking (pick.strategy = 'BATCH')
- [ ] P10-T4 Integration test tests/integration/cancelPutback.test.ts

## Phase 11: Manager Control Tower, KPIs, cycle-count scheduling, expiry sweep, shrinkage (SHOULD)
- [ ] P11-T1 Migration 022_reports.sql
- [ ] P11-T2 Control Tower & Real-Time KPIs API (GET /api/control-tower & GET /api/kpis)
- [ ] P11-T3 Automated ABC Cycle-Count Job & Daily Expiry Sweep Job
- [ ] P11-T4 Shift Handover Notes API & Control Tower Web UI
- [ ] P11-T5 Integration test tests/integration/kpisAndSweeps.test.ts

## Phase 12: Floor UX: scan input, scan simulator, PIN login, devices, offline queue (SHOULD)
- [ ] P12-T1 Migration 021_floor_ux.sql
- [ ] P12-T2 Badge + 4-Digit PIN Fast Floor Login (POST /api/auth/pin-login)
- [ ] P12-T3 Scanner-First Input Component & WebAudio Feedback
- [ ] P12-T4 Interactive Scan Simulator Floating Drawer (VITE_DEMO_MODE=true)
- [ ] P12-T5 Offline Mutation Queue for Floor Screens
- [ ] P12-T6 Integration test tests/integration/pinAndDevices.test.ts

## Phase 13: Order simulator, concurrency bots, recall trace, event replay, tamper demo (WOW)
- [ ] P13-T1 Lot Recall Traceability (GET /api/trace/lot/:lotId)
- [ ] P13-T2 Order Lifecycle Event Replay (GET /api/orders/:ref/replay)
- [ ] P13-T3 Order Wave Simulator & 20-Picker Concurrency Stress Proof (StressLabView.tsx)
- [ ] P13-T4 Interactive Audit Tamper & Detect Demo (DEMO_MODE=true)
- [ ] P13-T5 Web UI for Recall Trace & Stress Lab
- [ ] P13-T6 Integration test tests/integration/recallAndReplay.test.ts

## Phase 14: End-to-end tests, seed data, documentation, and demo script (MUST)
- [ ] P14-T1 Rich, Realistic Dark Store Seed Data
- [ ] P14-T2 Comprehensive End-to-End Integration Suite (tests/integration/e2eSoD.test.ts)
- [ ] P14-T3 Update scripts/smoke.ts
- [ ] P14-T4 Documentation (DEMO_SCRIPT.md)

---
next: P7-T2
