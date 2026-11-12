import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

export function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const migrationsDir = path.resolve(process.cwd(), 'migrations/warehouse');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      db.exec(sql);
    }
  }

  return db;
}

export function seedMinimal(db: Database.Database): void {
  const passwordHash = bcrypt.hashSync('Warehouse#2026', 10);
  const pinHash = bcrypt.hashSync('1111', 10);

  // Check if users has badge_id column
  const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
  const hasExtended = cols.includes('badge_id');

  const users = [
    { username: 'manager1', role: 'MANAGER', badge: 'BDG-MGR-01', display: 'Manager 1', zones: '[]' },
    { username: 'manager2', role: 'MANAGER', badge: 'BDG-MGR-02', display: 'Manager 2', zones: '[]' },
    { username: 'operator1', role: 'OPERATOR', badge: 'BDG-OPR-01', display: 'Operator 1', zones: '[]' },
    { username: 'operator2', role: 'OPERATOR', badge: 'BDG-OPR-02', display: 'Operator 2', zones: '[]' },
    { username: 'picker1', role: 'PICKER', badge: 'BDG-PCK-01', display: 'Picker 1', zones: '["A","B"]' },
    { username: 'picker2', role: 'PICKER', badge: 'BDG-PCK-02', display: 'Picker 2', zones: '["A","B","C"]' },
    { username: 'staff1', role: 'STAFF', badge: 'BDG-STF-01', display: 'Staff 1', zones: '[]' }
  ];

  for (const u of users) {
    if (hasExtended) {
      db.prepare(`
        INSERT OR IGNORE INTO users (username, display_name, password_hash, role, active, badge_id, pin_hash, zones)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      `).run(u.username, u.display, passwordHash, u.role, u.badge, pinHash, u.zones);
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO users (username, display_name, password_hash, role, active)
        VALUES (?, ?, ?, ?, 1)
      `).run(u.username, u.display, passwordHash, u.role);
    }
  }

  // Nav node for shelves
  db.prepare(`
    INSERT OR IGNORE INTO nav_nodes (id, kind, x, y)
    VALUES ('NODE-01', 'AISLE', 10, 10)
  `).run();

  // Products
  const prodCols = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map(c => c.name);
  const hasProdBarcode = prodCols.includes('barcode');

  if (hasProdBarcode) {
    db.prepare(`
      INSERT OR IGNORE INTO products (sku, name, category, storage_class, active, barcode, weight_g, price_paise)
      VALUES ('SKU-001', 'Test Product 1', 'Electronics', 'STANDARD', 1, 'SKU-001', 250, 15000),
             ('SKU-002', 'Test Product 2', 'Office', 'STANDARD', 1, 'SKU-002', 300, 25000)
    `).run();
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO products (sku, name, category, storage_class, active)
      VALUES ('SKU-001', 'Test Product 1', 'Electronics', 'STANDARD', 1),
             ('SKU-002', 'Test Product 2', 'Office', 'STANDARD', 1)
    `).run();
  }

  // Shelf S-01
  db.prepare(`
    INSERT OR IGNORE INTO shelves (code, aisle, bay, side, storage_class, status, nav_node_id, x, y)
    VALUES ('S-01', 'A', 1, 'L', 'STANDARD', 'ACTIVE', 'NODE-01', 10, 10)
  `).run();

  // Bins A-01-01, A-01-02, A-01-03
  const binCols = (db.prepare('PRAGMA table_info(bins)').all() as { name: string }[]).map(c => c.name);
  const hasPickFrozen = binCols.includes('pick_frozen');

  const bins = [
    { code: 'A-01-01', level: 1, capacity: 50 },
    { code: 'A-01-02', level: 2, capacity: 50 },
    { code: 'A-01-03', level: 3, capacity: 50 }
  ];

  for (const b of bins) {
    db.prepare(`
      INSERT OR IGNORE INTO bins (code, shelf_code, level, capacity, status, recount_required)
      VALUES (?, 'S-01', ?, ?, 'ACTIVE', 0)
    `).run(b.code, b.level, b.capacity);

    // Initial inventory row for bin
    db.prepare(`
      INSERT OR IGNORE INTO inventory (bin_code, sku, qty, reserved_qty)
      VALUES (?, NULL, 0, 0)
    `).run(b.code);
  }
}
