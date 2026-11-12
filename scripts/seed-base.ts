import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';

export function seedBase(db: Database.Database): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed in production environment.');
  }

  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'Warehouse#2026';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);
  const pinHash = bcrypt.hashSync('1111', 10);

  const tx = db.transaction(() => {
    // 1. Users
    const users = [
      { username: 'manager1', display_name: 'Manager 1', role: 'MANAGER', badge_id: 'BDG-MGR-01', zones: '[]', shift: 'MORNING' },
      { username: 'manager2', display_name: 'Manager 2', role: 'MANAGER', badge_id: 'BDG-MGR-02', zones: '[]', shift: 'EVENING' },
      { username: 'operator1', display_name: 'Operator 1', role: 'OPERATOR', badge_id: 'BDG-OPR-01', zones: '[]', shift: 'MORNING' },
      { username: 'operator2', display_name: 'Operator 2', role: 'OPERATOR', badge_id: 'BDG-OPR-02', zones: '[]', shift: 'EVENING' },
      { username: 'picker1', display_name: 'Picker 1', role: 'PICKER', badge_id: 'BDG-PCK-01', zones: '["A","B"]', shift: 'MORNING' },
      { username: 'picker2', display_name: 'Picker 2', role: 'PICKER', badge_id: 'BDG-PCK-02', zones: '["A","B","C"]', shift: 'EVENING' },
      { username: 'picker3', display_name: 'Picker 3', role: 'PICKER', badge_id: 'BDG-PCK-03', zones: '[]', shift: 'NIGHT' },
      { username: 'staff1', display_name: 'Staff 1', role: 'STAFF', badge_id: 'BDG-STF-01', zones: '[]', shift: 'MORNING' },
      { username: 'staff2', display_name: 'Staff 2', role: 'STAFF', badge_id: 'BDG-STF-02', zones: '[]', shift: 'EVENING' }
    ];

    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    const hasBadgeCol = cols.includes('badge_id');

    if (hasBadgeCol) {
      const insertOrUpdateUser = db.prepare(`
        INSERT INTO users (username, display_name, password_hash, role, active, badge_id, pin_hash, zones, shift)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          display_name = excluded.display_name,
          password_hash = excluded.password_hash,
          role = excluded.role,
          badge_id = excluded.badge_id,
          pin_hash = excluded.pin_hash,
          zones = excluded.zones,
          shift = excluded.shift
      `);
      for (const u of users) {
        insertOrUpdateUser.run(u.username, u.display_name, passwordHash, u.role, u.badge_id, pinHash, u.zones, u.shift);
      }
    } else {
      const insertUser = db.prepare(`
        INSERT INTO users (username, display_name, password_hash, role, active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(username) DO NOTHING
      `);
      for (const u of users) {
        insertUser.run(u.username, u.display_name, passwordHash, u.role);
      }
    }

    // 2. Products
    const products = [
      { sku: 'SKU001', name: 'Wireless Mouse', category: 'Peripherals', storage_class: 'STANDARD' },
      { sku: 'SKU002', name: 'Mechanical Keyboard', category: 'Peripherals', storage_class: 'STANDARD' },
      { sku: 'SKU003', name: 'USB-C Hub 7-in-1', category: 'Peripherals', storage_class: 'STANDARD' },
      { sku: 'SKU004', name: '27-inch Monitor', category: 'Displays', storage_class: 'STANDARD' },
      { sku: 'SKU005', name: 'Webcam 1080p', category: 'Peripherals', storage_class: 'STANDARD' },
      { sku: 'SKU006', name: 'USB-C Cable 1m', category: 'Cables', storage_class: 'STANDARD' },
      { sku: 'SKU007', name: 'HDMI Cable 2m', category: 'Cables', storage_class: 'STANDARD' },
      { sku: 'SKU008', name: 'Ethernet Cable Cat6 5m', category: 'Cables', storage_class: 'STANDARD' },
      { sku: 'SKU009', name: 'DisplayPort Cable 1.5m', category: 'Cables', storage_class: 'STANDARD' },
      { sku: 'SKU010', name: 'Aluminium Laptop Stand', category: 'Accessories', storage_class: 'STANDARD' },
      { sku: 'SKU011', name: 'Laptop Sleeve 15-inch', category: 'Accessories', storage_class: 'STANDARD' },
      { sku: 'SKU012', name: 'Portable SSD 1TB', category: 'Storage', storage_class: 'STANDARD' },
      { sku: 'SKU013', name: 'USB Flash Drive 64GB', category: 'Storage', storage_class: 'STANDARD' },
      { sku: 'SKU014', name: 'microSD Card 128GB', category: 'Storage', storage_class: 'STANDARD' },
      { sku: 'SKU015', name: 'Wi-Fi 6 Router', category: 'Networking', storage_class: 'STANDARD' },
      { sku: 'SKU016', name: 'Network Switch 8-port', category: 'Networking', storage_class: 'STANDARD' },
      { sku: 'SKU017', name: 'Wi-Fi Range Extender', category: 'Networking', storage_class: 'STANDARD' },
      { sku: 'SKU018', name: 'Wireless Headset', category: 'Audio', storage_class: 'STANDARD' },
      { sku: 'SKU019', name: 'Bluetooth Speaker', category: 'Audio', storage_class: 'STANDARD' },
      { sku: 'SKU020', name: 'LED Desk Lamp', category: 'Office', storage_class: 'STANDARD' },
      { sku: 'SKU021', name: 'Ergonomic Mouse Pad', category: 'Office', storage_class: 'STANDARD' },
      { sku: 'SKU022', name: 'Notebook A5 (5-pack)', category: 'Office', storage_class: 'STANDARD' },
      { sku: 'SKU023', name: 'Lithium Power Bank 20000mAh', category: 'Batteries', storage_class: 'HAZMAT' },
      { sku: 'SKU024', name: 'AA Lithium Batteries 8-pack', category: 'Batteries', storage_class: 'HAZMAT' }
    ];

    const insertProduct = db.prepare(`
      INSERT INTO products (sku, name, category, storage_class, unit, max_receive_qty, active)
      VALUES (?, ?, ?, ?, 'EA', 5000, 1)
      ON CONFLICT(sku) DO NOTHING
    `);
    for (const p of products) {
      insertProduct.run(p.sku, p.name, p.category, p.storage_class);
    }

    // 3. Navigation Graph Nodes
    const insertNode = db.prepare(`
      INSERT INTO nav_nodes (id, kind, x, y)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    // DOCK and PACK
    insertNode.run('DOCK', 'DOCK', 0, 0);
    insertNode.run('PACK', 'PACK', 80, 0);

    const aisles = ['A', 'B', 'C', 'D'];
    const aisleX: Record<string, number> = { A: 10, B: 30, C: 50, D: 70 };

    // Cross nodes
    for (const a of aisles) {
      insertNode.run(`XB-${a}`, 'CROSS', aisleX[a], 0);
      insertNode.run(`XT-${a}`, 'CROSS', aisleX[a], 50);
    }

    // Aisle nodes: bay 1..6, y = 10 + (bay - 1) * 6
    for (const a of aisles) {
      for (let bay = 1; bay <= 6; bay++) {
        const bayStr = bay.toString().padStart(2, '0');
        const y = 10 + (bay - 1) * 6;
        insertNode.run(`N-${a}-${bayStr}`, 'AISLE', aisleX[a], y);
      }
    }

    // 4. Navigation Graph Edges
    const insertEdge = db.prepare(`
      INSERT INTO nav_edges (from_node, to_node, distance)
      VALUES (?, ?, ?)
      ON CONFLICT(from_node, to_node) DO NOTHING
    `);

    function addEdge(u: string, v: string, dist: number) {
      const [from, to] = u < v ? [u, v] : [v, u];
      insertEdge.run(from, to, dist);
    }

    // Bottom cross edges
    addEdge('DOCK', 'XB-A', 10);
    addEdge('XB-A', 'XB-B', 20);
    addEdge('XB-B', 'XB-C', 20);
    addEdge('XB-C', 'XB-D', 20);
    addEdge('XB-D', 'PACK', 10);

    // Top cross edges
    addEdge('XT-A', 'XT-B', 20);
    addEdge('XT-B', 'XT-C', 20);
    addEdge('XT-C', 'XT-D', 20);

    // Aisle vertical edges
    for (const a of aisles) {
      // XB to N-1
      addEdge(`XB-${a}`, `N-${a}-01`, 10);
      // Bay to bay (dist 6)
      for (let bay = 1; bay < 6; bay++) {
        const b1 = bay.toString().padStart(2, '0');
        const b2 = (bay + 1).toString().padStart(2, '0');
        addEdge(`N-${a}-${b1}`, `N-${a}-${b2}`, 6);
      }
      // N-6 to XT (y=40 to y=50, dist 10)
      addEdge(`N-${a}-06`, `XT-${a}`, 10);
    }

    // 5. Shelves and Bins
    const insertShelf = db.prepare(`
      INSERT INTO shelves (code, aisle, bay, side, storage_class, status, nav_node_id, x, y)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO NOTHING
    `);

    const insertBin = db.prepare(`
      INSERT INTO bins (code, shelf_code, level, capacity, status, recount_required)
      VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT(code) DO NOTHING
    `);

    const capacityByLevel: Record<number, number> = { 1: 120, 2: 100, 3: 80, 4: 60 };

    for (const a of aisles) {
      for (let bay = 1; bay <= 6; bay++) {
        const bayStr = bay.toString().padStart(2, '0');
        const navNodeId = `N-${a}-${bayStr}`;
        const x = aisleX[a];
        const y = 10 + (bay - 1) * 6;

        for (const side of ['L', 'R']) {
          const shelfCode = `${a}-${bayStr}-${side}`;
          // Storage class: aisle D bays 1-2 are HAZMAT, others STANDARD
          const storageClass = (a === 'D' && (bay === 1 || bay === 2)) ? 'HAZMAT' : 'STANDARD';
          // Status: B-06-L is MAINTENANCE
          const shelfStatus = (shelfCode === 'B-06-L') ? 'MAINTENANCE' : 'ACTIVE';

          insertShelf.run(shelfCode, a, bay, side, storageClass, shelfStatus, navNodeId, x, y);

          for (let level = 1; level <= 4; level++) {
            const binCode = `${shelfCode}-${level}`;
            const capacity = capacityByLevel[level];
            let binStatus = 'ACTIVE';
            if (binCode === 'D-06-R-3') binStatus = 'BLOCKED';
            if (binCode === 'D-06-R-4') binStatus = 'DAMAGED';

            insertBin.run(binCode, shelfCode, level, capacity, binStatus);
          }
        }
      }
    }

    // 6. Pre-populate inventory rows if inventory table exists
    const hasInventory = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory'
    `).get();

    if (hasInventory) {
      const allBins = db.prepare('SELECT code FROM bins').all() as { code: string }[];
      const insertInv = db.prepare(`
        INSERT INTO inventory (bin_code, sku, qty, reserved_qty)
        VALUES (?, NULL, 0, 0)
        ON CONFLICT(bin_code) DO NOTHING
      `);
      for (const b of allBins) {
        insertInv.run(b.code);
      }
    }
  });

  tx();
}

// When executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/seed-base.ts')) {
  const warehouseDbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  const db = new Database(warehouseDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  console.log(`Seeding base data into ${warehouseDbPath}...`);
  seedBase(db);
  db.close();
  console.log('Base seed completed successfully.');
}
