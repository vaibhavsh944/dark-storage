# Engine 4: Warehouse Operations & Alert Dashboard (WT) – Weekly Progress Report
**Dark Storage Shelf & Allocator Platform**

---

### Week 1 – Project Selection and Problem Understanding
- Finalized the project idea: Dark Storage Shelf and Allocator Platform for automated, lights-out warehouse operations.
- Studied user interface and coordination challenges in modern warehouses, including operational blindness, delayed status updates, and unauthorized access.
- Identified the need for a unified API Gateway, role-based access control, real-time event broadcasting, and intuitive 2D/3D warehouse visualization.
- Discussed project scope, full-stack microservice orchestration, and separating client presentation from backend processing engines.

---

### Week 2 – Requirement Analysis
- Identified the functional and non-functional requirements for the gateway and presentation subsystem.
- Divided the system into four decoupled engines: Request Coordination (E1), Smart Placement & Pick Optimization (E2), Stock Tracking & Consistency (E3), and Operations Dashboard & Gateway (E4).
- Defined the core responsibilities of E4: API reverse proxying, JWT authentication, RBAC enforcement, WebSocket push broadcasting, real-time KPI metrics, and UI views.
- Formulated the key functional requirements handled by E4: FR4 (User Authentication), FR5 (Reverse Proxy Routing), FR17 (Idempotency Tracking), FR18 (JWT Verification), FR19 (RBAC Authorization), and FR28 (Real-Time WebSockets).

---

### Week 3 – System Architecture, Monorepo Setup & Idempotency Table
- Built the monorepo workspace structure (`pnpm-workspace.yaml`) linking `@dark-storage/shared`, `services/gateway`, and `apps/web`.
- Implemented the Idempotency tracking table (`idempotency_keys`) and audit log table (`audit_log`) in SQLite.
- Engineered gateway idempotency middleware: hashes incoming request bodies with UUID keys and caches responses, preventing accidental duplicate form submissions.
- Designed the shared TypeScript DTO library containing uniform API response wrappers and standard error envelopes.

---

### Week 4 – Authentication, RBAC & API Reverse Proxying
- Built the JWT authentication controller (`POST /api/auth/login`) using `bcryptjs` for secure password verification.
- Developed `authMiddleware` to validate Bearer tokens and decode user session payloads (`{ id, username, role, display_name }`).
- Implemented role-based access control middleware (`rbacMiddleware`) supporting 4 warehouse roles: `MANAGER`, `OPERATOR`, `PICKER`, and `STAFF`.
- Built the reverse proxy router in Express, dispatching requests internally to Engine 1 (port 4001), Engine 2 (port 4002), and Engine 3 (port 4003) using an internal secret key (`x-internal-token`).

---

### Week 5 – Operations Dashboard, KPI Metrics & AppShell UI
- Developed the Dashboard aggregation endpoint (`GET /api/dashboard`) computing live warehouse KPIs: Staged Units, Reserved Stock, Available ATP, Pending Orders, Active Missions, and Daily Throughput.
- Created the responsive React AppShell layout using Material Design 3 design tokens (`theme.css`).
- Built the fast Role Switcher component in the top navigation bar, allowing instant switching between demo accounts (`manager1`, `operator1`, `picker1`, `staff1`).
- Implemented sidebar navigation filtering that dynamically hides or shows pages based on the active role's permissions.

---

### Week 6 – Real-Time WebSocket Hub & Interactive Views
- Engineered the real-time WebSocket Hub (`services/gateway/src/ws/hub.ts`) running at path `/ws`.
- Implemented the Transactional Outbox polling loop: polls `outbox_events` every 1000ms and broadcasts live updates to connected browsers.
- Built gap-free event replay supporting `since=<seq>` query parameters, enabling tablets to automatically catch up on missed events after temporary network drops.
- Developed client-side `useRealtime.ts` hook and `realtimeStore.ts` in Zustand, automatically triggering TanStack Query cache invalidations on events.

---

### Week 7 – Warehouse 2D/3D Digital Twin & Full-Stack Integration
- Developed the Interactive SVG Floorplan view (`FloorplanView.tsx`): rendered clickable shelves with live color-coded fill levels and path overlays.
- Built the 2.5D Isometric Digital Twin (`IsometricCanvas.tsx`) using HTML5 Canvas 2D with camera panning, zooming, and shelf height rendering.
- Connected the complete receiving, picking, packing, exceptions, and inventory pages to live Gateway endpoints.
- Implemented the expandable Live Event Feed Drawer (`EventFeedDrawer.tsx`), displaying real-time warehouse activities as they occur.

---

### Week 8 – Validation, Performance and Final Documentation
- Conducted full-stack stress testing: verified sub-10ms response times on dashboard metrics and sub-50ms WebSocket event delivery.
- Validated role-based security: verified that unauthorized roles are blocked from accessing administrative or sensitive operational endpoints.
- Verified one-click launch scripts (`run.bat`, `start.bat`) running all 3 engines, the gateway, and the frontend concurrently.
- Completed comprehensive Technical Architecture & Codebase Reports ([an1.md](file:///d:/mini%20project%20final/an1.md)), API catalogs, and project defense documentation.

---

### Overall Progress
During the first eight weeks, Engine 4 (WT) progressed from an initial API Gateway prototype to a complete, production-grade warehouse operations hub. Particular attention was given to stateless JWT authentication, fine-grained Role-Based Access Control (RBAC), request idempotency guarding, gap-free WebSocket event streaming, and an intuitive 2D/3D digital twin visualization interface.
