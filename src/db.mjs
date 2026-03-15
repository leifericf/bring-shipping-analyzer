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
 * Includes migrations for existing databases from earlier versions.
 */
function initSchema() {
  // Migrate: add account_id column to runs if it doesn't exist (for existing DBs)
  const runsColumns = _db.prepare("PRAGMA table_info(runs)").all();
  if (runsColumns.length > 0 && !runsColumns.find(c => c.name === 'account_id')) {
    _db.exec('ALTER TABLE runs ADD COLUMN account_id INTEGER REFERENCES accounts(id)');
  }

  _db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      api_uid            TEXT NOT NULL,
      api_key            TEXT NOT NULL,
      customer_number    TEXT NOT NULL,
      origin_postal_code TEXT NOT NULL DEFAULT '0174',
      config             TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      account_id         INTEGER REFERENCES accounts(id),
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

    CREATE TABLE IF NOT EXISTS invoices (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id                   INTEGER NOT NULL REFERENCES runs(id),
      invoice_number           TEXT NOT NULL,
      invoice_date             TEXT,
      total_amount             REAL,
      currency                 TEXT,
      specification_available  INTEGER NOT NULL DEFAULT 0
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
    CREATE INDEX IF NOT EXISTS idx_invoices_run ON invoices(run_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_line_items_run ON invoice_line_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_results_run ON analysis_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_account ON runs(account_id);
  `);
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------

export function getAllAccounts() {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts ORDER BY name').all();
}

export function getAccount(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function createAccount(name, apiUid, apiKey, customerNumber, originPostalCode, config) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO accounts (name, api_uid, api_key, customer_number, origin_postal_code, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, apiUid, apiKey, customerNumber, originPostalCode, JSON.stringify(config));
  return result.lastInsertRowid;
}

export function updateAccount(id, name, apiUid, apiKey, customerNumber, originPostalCode) {
  const db = getDb();
  db.prepare(`
    UPDATE accounts SET name = ?, api_uid = ?, api_key = ?, customer_number = ?, origin_postal_code = ?
    WHERE id = ?
  `).run(name, apiUid, apiKey, customerNumber, originPostalCode, id);
}

export function updateAccountConfig(id, config) {
  const db = getDb();
  db.prepare('UPDATE accounts SET config = ? WHERE id = ?').run(JSON.stringify(config), id);
}

export function deleteAccount(id) {
  const db = getDb();
  db.transaction(() => {
    // Delete all child data for every run belonging to this account
    const runs = db.prepare('SELECT id FROM runs WHERE account_id = ?').all(id);
    for (const run of runs) {
      db.prepare('DELETE FROM analysis_results WHERE run_id = ?').run(run.id);
      db.prepare('DELETE FROM invoice_line_items WHERE run_id = ?').run(run.id);
      db.prepare('DELETE FROM invoices WHERE run_id = ?').run(run.id);
      db.prepare('DELETE FROM zones WHERE run_id = ?').run(run.id);
      db.prepare('DELETE FROM shipping_rates WHERE run_id = ?').run(run.id);
    }
    db.prepare('DELETE FROM runs WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  })();
}

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

export function createRun(customerNumber, originPostalCode, configSnapshot, accountId = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (account_id, customer_number, origin_postal_code, config_snapshot, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);
  const result = stmt.run(accountId, customerNumber, originPostalCode, JSON.stringify(configSnapshot));
  return result.lastInsertRowid;
}

export function deleteRun(id) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM analysis_results WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM invoice_line_items WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM invoices WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM zones WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM shipping_rates WHERE run_id = ?').run(id);
    db.prepare('DELETE FROM runs WHERE id = ?').run(id);
  })();
}

export function updateRunStatus(runId, status) {
  const db = getDb();
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
}

export function getRun(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
}

export function getRunsForAccount(accountId) {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE account_id = ? ORDER BY created_at DESC').all(accountId);
}

export function getRecentRuns(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, a.name as account_name
    FROM runs r
    LEFT JOIN accounts a ON r.account_id = a.id
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit);
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
      stmt.run(runId, r.country, r.country_code, r.postal_code, r.zone != null ? String(r.zone) : null, r.service_id, r.service_name, r.weight_g, r.price_nok);
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
      stmt.run(runId, z.country_code, z.postal_code, z.service_id, z.zone != null ? String(z.zone) : null);
    }
  });
  insertMany(zones);
}

// ---------------------------------------------------------------------------
// Invoice helpers
// ---------------------------------------------------------------------------

export function insertInvoices(runId, invoices) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO invoices (run_id, invoice_number, invoice_date, total_amount, currency, specification_available)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const inv of rows) {
      stmt.run(runId, inv.invoiceNumber, inv.invoiceDate, inv.totalAmount, inv.currency, inv.specificationAvailable ? 1 : 0);
    }
  });
  insertMany(invoices);
}

export function getInvoices(runId) {
  const db = getDb();
  return db.prepare('SELECT * FROM invoices WHERE run_id = ? ORDER BY invoice_date DESC').all(runId);
}

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

export function getAnalysisResult(runId) {
  const db = getDb();
  return db.prepare('SELECT results_markdown FROM analysis_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
}

/**
 * Get shipping rates for a run.
 */
export function getShippingRates(runId) {
  const db = getDb();
  return db.prepare('SELECT country, country_code, postal_code, zone, service_id, service_name, weight_g, price_nok FROM shipping_rates WHERE run_id = ?').all(runId);
}

/**
 * Get invoice line items for a run.
 */
export function getInvoiceLineItems(runId) {
  const db = getDb();
  return db.prepare(`
    SELECT invoice_number, invoice_date, shipment_number, package_number, product_code, product, description, weight_kg, gross_price, discount, agreement_price, currency_code, from_postal_code, to_postal_code, to_city, delivery_country
    FROM invoice_line_items WHERE run_id = ?
  `).all(runId);
}
