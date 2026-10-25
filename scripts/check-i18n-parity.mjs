import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const enPath = path.join(rootDir, 'apps/web/src/lib/i18n/locales/en.json');
const zhPath = path.join(rootDir, 'apps/web/src/lib/i18n/locales/zh.json');

const PLURAL_SUFFIXES = ['_plural', '_zero', '_one', '_two', '_few', '_many', '_other'];

function normalizeKey(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) {
      return key.slice(0, -suffix.length);
    }
  }
  return key;
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const enContent = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const zhContent = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

const enKeys = flattenKeys(enContent);
const zhKeys = flattenKeys(zhContent);

const enNorm = new Set(enKeys.map(normalizeKey));
const zhNorm = new Set(zhKeys.map(normalizeKey));

const missingInZh = enKeys.filter((k) => !zhNorm.has(normalizeKey(k)));
const missingInEn = zhKeys.filter((k) => !enNorm.has(normalizeKey(k)));

if (missingInZh.length > 0 || missingInEn.length > 0) {
  console.error('i18n key parity check failed:');
  if (missingInZh.length > 0) {
    console.error(`\nMissing in zh.json (${missingInZh.length}):`);
    for (const key of missingInZh) {
      console.error(`  - ${key}`);
    }
  }
  if (missingInEn.length > 0) {
    console.error(`\nMissing in en.json (${missingInEn.length}):`);
    for (const key of missingInEn) {
      console.error(`  - ${key}`);
    }
  }
  process.exit(1);
}

console.log(
  `✓ i18n key parity check passed (${enKeys.length} keys in en.json, ${zhKeys.length} keys in zh.json).`,
);
process.exit(0);
