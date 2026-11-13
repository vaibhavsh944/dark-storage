import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('P4-T6: Guard against direct stock writes outside ledger', () => {
  it('asserts no active code runs INSERT INTO inventory, UPDATE inventory SET qty, or UPDATE bins SET current_qty outside ledger', () => {
    const servicesDir = path.resolve(process.cwd(), 'services');

    function scanDir(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(fullPath));
        } else if (entry.isFile() && fullPath.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const allTsFiles = scanDir(servicesDir);
    const forbiddenPatterns = [
      /\bINSERT\s+INTO\s+inventory\b/i,
      /\bUPDATE\s+inventory\s+SET\b.*?\bqty\b/i,
      /\bUPDATE\s+bins\s+SET\b.*?\bcurrent_qty\b/i
    ];

    const violations: Array<{ file: string; line: number; matchedText: string }> = [];

    for (const file of allTsFiles) {
      const normalizedPath = file.replace(/\\/g, '/');

      // Exclude postLedger.ts and backfillOpeningLedger.ts
      if (
        normalizedPath.endsWith('/ledger/postLedger.ts') ||
        normalizedPath.endsWith('/ledger/backfillOpeningLedger.ts') ||
        normalizedPath.endsWith('/ledger/backfillOpening.ts')
      ) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(servicesDir, file).replace(/\\/g, '/'),
              line: index + 1,
              matchedText: line.trim()
            });
          }
        }
      });
    }

    expect(
      violations,
      `Found direct stock writes outside ledger:\n${JSON.stringify(violations, null, 2)}`
    ).toHaveLength(0);
  });
});
