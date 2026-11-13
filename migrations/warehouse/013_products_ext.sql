-- Migration 013: Products extension with physical and slotting attributes

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
