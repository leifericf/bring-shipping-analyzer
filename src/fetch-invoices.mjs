// Imperative shell for invoice fetching.
// Handles HTTP calls, polling, logging, and DB persistence.
// Business logic lives in src/core/invoices/*.

import { requireRunId, requireBringCredentials, sleep, fetchWithRetry, httpsGet, runMain } from './lib.mjs';
import { computeDateRange } from './core/formatting.mjs';
import { getDb, insertInvoices, insertInvoiceLineItems, closeDb } from './db.mjs';
import { buildInvoiceListUrl, normalizeInvoiceList, parseInvoiceXmlLines } from './core/invoices/normalize.mjs';

const RUN_ID = requireRunId();
const { customerNumber, authHeaders } = requireBringCredentials();

const REPORTS_GENERATE_URL = 'https://www.mybring.com/reports/api/generate';
const REPORT_TYPE = 'MASTER-SPECIFIED_INVOICE';
const INVOICE_LOOKBACK_DAYS = 365;
const MAX_REPORT_POLL_ATTEMPTS = 30;
const REPORT_POLL_INTERVAL_MS = 2000;
const INVOICE_FETCH_DELAY_MS = 1000;

// ── HTTP helpers (impure: network) ───────────────────────────────────────────

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: { ...authHeaders, 'Accept': 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }
  return response.json();
}

// Note: Mybring report/download endpoints reject Node.js fetch() (undici) with
// 406 Not Acceptable, but work fine with node:https. We use httpsGet() for these.
async function fetchXml(url) {
  const result = await httpsGet(url, { ...authHeaders, 'Accept': 'application/xml' });
  if (result.status !== 200) {
    throw new Error(`API error ${result.status}: ${result.body.toString('utf8')}`);
  }
  return result.body.toString('utf8');
}

async function generateInvoiceReport(invoiceNumber) {
  const data = await fetchJson(`${REPORTS_GENERATE_URL}/${customerNumber}/${REPORT_TYPE}?invoiceNumber=${invoiceNumber}`);
  return data.statusUrl;
}

async function waitForReport(statusUrl) {
  for (let attempts = 0; attempts < MAX_REPORT_POLL_ATTEMPTS; attempts++) {
    const data = await fetchJson(statusUrl);
    if (data.status === 'DONE') return { xmlUrl: data.xmlUrl, xlsUrl: data.xlsUrl };
    if (data.status === 'FAILED') throw new Error('Report generation failed');
    await sleep(REPORT_POLL_INTERVAL_MS);
  }
  throw new Error('Report generation timeout');
}

// ── Main pipeline (impure: HTTP, logging, DB) ────────────────────────────────

runMain(async () => {
  getDb();

  console.log('Fetching invoices...\n');
  console.log(`Customer Number: ${customerNumber}\n`);

  // Build URL (pure) and fetch (impure)
  const { fromDate, toDate } = computeDateRange(new Date(), INVOICE_LOOKBACK_DAYS);
  const url = buildInvoiceListUrl(customerNumber, fromDate, toDate);
  const rawData = await fetchJson(url);

  // Normalize (pure)
  const invoiceRecords = normalizeInvoiceList(rawData.invoices);
  console.log(`Found ${invoiceRecords.length} invoices\n`);

  // Persist invoice metadata
  insertInvoices(RUN_ID, invoiceRecords);

  // Fetch and parse line items for each invoice (impure loop, pure parsing)
  const allLineItems = [];

  for (const invoice of rawData.invoices || []) {
    console.log(`Processing invoice ${invoice.invoiceNumber} (${invoice.invoiceDate})...`);
    console.log(`  Amount: ${invoice.totalAmount} ${invoice.currency}`);

    if (!invoice.invoiceSpecificationAvailable) {
      console.log('  No specification available, skipping line items...\n');
      continue;
    }

    try {
      console.log('  Generating report...');
      const statusUrl = await generateInvoiceReport(invoice.invoiceNumber);
      console.log('  Waiting for report...');
      const report = await waitForReport(statusUrl);
      console.log('  Fetching XML...');
      const xml = await fetchXml(report.xmlUrl);

      // Parse XML (pure)
      const lines = parseInvoiceXmlLines(xml);
      console.log(`  Found ${lines.length} line items\n`);
      allLineItems.push(...lines);
    } catch (error) {
      console.error(`  Error processing invoice ${invoice.invoiceNumber}: ${error.message}`);
      if (error.stack) console.error(error.stack);
      console.log('');
    }
    await sleep(INVOICE_FETCH_DELAY_MS);
  }

  // Persist line items
  insertInvoiceLineItems(RUN_ID, allLineItems);
  closeDb();

  console.log(`\nDone! Saved ${invoiceRecords.length} invoices and ${allLineItems.length} line items to database.`);
});
