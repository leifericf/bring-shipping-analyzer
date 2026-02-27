import Database from 'better-sqlite3';
import fs from 'fs';
import { join } from 'path';
import { DATA_DIR } from './lib.mjs';

const DB_PATH = join(DATA_DIR, 'bring.db');

let _db = null;

/**
 * Get (or create) the singleton database connection.
 */
export function getDb() {
  if (_db) return _db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema();
  return _db;
}

/**
 * Close the database connection.
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Create tables if they don't exist.
 */
function initSchema() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      customer_number    TEXT NOT NULL,
      origin_postal_code TEXT NOT NULL,
      output_dir         TEXT,
      config_snapshot    TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS shipping_rates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       INTEGER NOT NULL REFERENCES runs(id),
      country      TEXT NOT NULL,
      country_code TEXT NOT NULL,
      postal_code  TEXT NOT NULL,
      zone         TEXT,
      service_id   TEXT NOT NULL,
      service_name TEXT NOT NULL,
      weight_g     INTEGER NOT NULL,
      price_nok    REAL
    );

    CREATE TABLE IF NOT EXISTS zones (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       INTEGER NOT NULL REFERENCES runs(id),
      country_code TEXT NOT NULL,
      postal_code  TEXT NOT NULL,
      service_id   TEXT NOT NULL,
      zone         TEXT
    );

    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id           INTEGER NOT NULL REFERENCES runs(id),
      invoice_number   TEXT,
      invoice_date     TEXT,
      shipment_number  TEXT,
      package_number   TEXT,
      product_code     TEXT,
      product          TEXT,
      description      TEXT,
      weight_kg        REAL,
      gross_price      REAL,
      discount         REAL,
      agreement_price  REAL,
      currency_code    TEXT,
      from_postal_code TEXT,
      to_postal_code   TEXT,
      to_city          TEXT,
      delivery_country TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id           INTEGER NOT NULL REFERENCES runs(id),
      results_markdown TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shipping_rates_run ON shipping_rates(run_id);
    CREATE INDEX IF NOT EXISTS idx_zones_run ON zones(run_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_line_items_run ON invoice_line_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_results_run ON analysis_results(run_id);
  `);
}

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

export function createRun(customerNumber, originPostalCode, outputDir, configSnapshot) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (customer_number, origin_postal_code, output_dir, config_snapshot, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);
  const result = stmt.run(customerNumber, originPostalCode, outputDir, JSON.stringify(configSnapshot));
  return result.lastInsertRowid;
}

export function updateRunStatus(runId, status) {
  const db = getDb();
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
}

// ---------------------------------------------------------------------------
// Shipping rate helpers
// ---------------------------------------------------------------------------

export function insertShippingRates(runId, rates) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO shipping_rates (run_id, country, country_code, postal_code, zone, service_id, service_name, weight_g, price_nok)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run(runId, r.country, r.country_code, r.postal_code, r.zone, r.service_id, r.service_name, r.weight_g, r.price_nok);
    }
  });
  insertMany(rates);
}

export function insertZones(runId, zones) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO zones (run_id, country_code, postal_code, service_id, zone)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const z of rows) {
      stmt.run(runId, z.country_code, z.postal_code, z.service_id, z.zone);
    }
  });
  insertMany(zones);
}

// ---------------------------------------------------------------------------
// Invoice helpers
// ---------------------------------------------------------------------------

export function insertInvoiceLineItems(runId, lineItems) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO invoice_line_items (run_id, invoice_number, invoice_date, shipment_number, package_number, product_code, product, description, weight_kg, gross_price, discount, agreement_price, currency_code, from_postal_code, to_postal_code, to_city, delivery_country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const l of rows) {
      stmt.run(
        runId, l.invoiceNumber, l.invoiceDate, l.shipmentNumber, l.packageNumber,
        l.productCode, l.product, l.description, l.weightKg,
        l.grossPrice, l.discount, l.agreementPrice, l.currency,
        l.fromPostalCode, l.toPostalCode, l.toCity, l.toCountry,
      );
    }
  });
  insertMany(lineItems);
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

export function insertAnalysisResult(runId, markdown) {
  const db = getDb();
  db.prepare('INSERT INTO analysis_results (run_id, results_markdown) VALUES (?, ?)').run(runId, markdown);
}

/**
 * Get shipping rates for a run, as plain objects matching the CSV column names.
 */
export function getShippingRates(runId) {
  const db = getDb();
  return db.prepare('SELECT country, country_code, postal_code, zone, service_id, service_name, weight_g, price_nok FROM shipping_rates WHERE run_id = ?').all(runId);
}

/**
 * Get invoice line items for a run, as plain objects matching the CSV column names.
 */
export function getInvoiceLineItems(runId) {
  const db = getDb();
  return db.prepare(`
    SELECT invoice_number, invoice_date, shipment_number, package_number, product_code, product, description, weight_kg, gross_price, discount, agreement_price, currency_code, from_postal_code, to_postal_code, to_city, delivery_country
    FROM invoice_line_items WHERE run_id = ?
  `).all(runId);
}
