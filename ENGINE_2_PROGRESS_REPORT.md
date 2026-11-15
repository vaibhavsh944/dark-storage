# Engine 2: Smart Placement & Pick Optimization Engine (SPE) – Weekly Progress Report
**Dark Storage Shelf & Allocator Platform**

---

### Week 1 – Project Selection and Problem Understanding
- Finalized the project idea: Dark Storage Shelf and Allocator Platform for automated, lights-out warehouse operations.
- Studied the problems associated with warehouse storage, spatial allocation, travel-distance wastage, and manual picking bottlenecks.
- Identified the need for algorithmic shelf placement recommendations, spatial graph routing, and multi-stop picking optimization.
- Discussed project objectives, computational efficiency trade-offs, and mathematical graph modeling of physical warehouse layouts.

---

### Week 2 – Requirement Analysis
- Identified the functional and non-functional requirements for the spatial optimization subsystem.
- Divided the system into four decoupled engines: Request Coordination (E1), Smart Placement & Pick Optimization (E2), Stock Tracking & Consistency (E3), and Operations Dashboard & Gateway (E4).
- Defined the core responsibilities of E2: graph modeling, obstacle-free pathfinding, Traveling Salesperson Problem (TSP) optimization, and multi-factor bin allocation scoring.
- Formulated the key functional requirements handled by E2: FR8 (Graph Representation), FR9 (Distance Metrics), FR22 (Shortest Path Routing), FR23 (TSP Pick Optimization), and FR24 (Smart Placement Scoring).

---

### Week 3 – System Architecture and Engine Decomposition
- Studied the system architecture and communication between the API Gateway (E4), Scheduler (E1), Optimizer (E2), and Ledger (E3).
- Defined the inputs required by E2: incoming SKU attributes (storage class, dimensions), dock origin, pick stop coordinates, and shelf physical metadata.
- Defined the expected outputs of E2: ranked candidate bin recommendations with score breakdowns, ordered pick stop sequences, total path distance in meters, and SVG polyline geometry.
- Established clean REST interface contracts (`RouteOptimizationRequest` and `PlacementRecommendationResponse`) in `@dark-storage/shared`.

---

### Week 4 – Warehouse Graph Design & Dijkstra Pathfinding
- Modeled the warehouse physical layout as an undirected coordinate graph consisting of navigation nodes and weighted edges.
- Represented aisle intersections, shelf access waypoints, dock areas, and charging bays as graph vertices ($x, y, z$ coordinates).
- Implemented edge cost calculations representing traversal distance in centimeters, taking into account cornering and directional constraints.
- Built an in-memory adjacency list graph representation and implemented Dijkstra's algorithm for shortest-path calculation between any two warehouse points.

---

### Week 5 – Smart Storage Placement & Multi-Factor Scoring
- Designed the candidate bin selection algorithm for inbound stock based on product storage class (e.g. `STANDARD`, `HAZMAT`, `SECURE`).
- Developed a multi-factor placement scoring formula balancing travel distance, shelf ergonomics, and available capacity:
  $$\text{Score} = (100 - \text{DistanceToDock}) + (20 \times \text{ErgonomicLevel}) + (10 \times \text{FreeCapacity})$$
- Prioritized waist-height shelf levels (levels 2 and 3) for fast-moving goods to minimize mechanical lifting wear and picker fatigue.
- Verified placement rules: automatically filtered out blocked bins, damaged locations, and shelves currently under maintenance.

---

### Week 6 – Picking Route Optimization: Held-Karp & 2-Opt Hybrid
- Studied the NP-hard Traveling Salesperson Problem (TSP) for sequencing multiple picking stops across warehouse aisles.
- Implemented the Held-Karp Dynamic Programming algorithm ($O(n^2 2^n)$) to calculate mathematically guaranteed optimal pick sequences for orders with $N \le 12$ stops.
- Built an adaptive 2-Opt local search heuristic that automatically takes over for large batch orders ($N > 12$) to keep execution time under 50ms.
- Evaluated performance: the hybrid solver eliminated zigzagging and reduced picker travel distance by 30% to 35% compared to alphabetical bin picking.

---

### Week 7 – Geometry Generation & Error Handling Design
- Designed the coordinate transformation pipeline converting topological graph paths into SVG polyline coordinates for frontend visual map rendering.
- Implemented failure handling for unreachable nodes or blocked aisles: developed fallback routing returning detour paths with a `PATH_OBSTRUCTED` warning flag.
- Integrated the placement evaluation endpoint (`POST /api/placement/recommend`) and route optimizer endpoint (`POST /api/routing/optimize-pick`).
- Added input validation guarding against negative coordinates, missing destination nodes, or zero-stop requests.

---

### Week 8 – Validation, Performance and Documentation
- Benchmarked pathfinding and optimization execution times: Dijkstra shortest path resolved in $< 2\text{ms}$; Held-Karp TSP solved in $< 18\text{ms}$.
- Verified route geometry consistency: tested 50 generated pick routes on the interactive SVG floorplan and verified zero path intersections or shelf-rack collisions.
- Validated placement scoring accuracy: confirmed that HAZMAT products are strictly routed to HAZMAT-certified shelves with 100% compliance.
- Finalized engine documentation, algorithmic complexity analyses, test reports, and presentation materials.

---

### Overall Progress
During the first eight weeks, Engine 2 (SPE) progressed through problem definition, topological graph design, Dijkstra pathfinding, multi-factor storage placement scoring, and hybrid TSP route optimization. Particular attention was given to the Held-Karp dynamic programming formulation, 2-Opt heuristic fallback, ergonomic shelf scoring, and seamless SVG coordinate generation for live warehouse visualization.
