import { getAuthHeaders, sleep, fetchWithRetry, httpsGet } from './lib.mjs';
import { getDb, insertInvoices, insertInvoiceLineItems, closeDb } from './db.mjs';

const RUN_ID = Number(process.env.RUN_ID);
if (!RUN_ID) {
  console.error('Error: RUN_ID environment variable is required. Use "npm start" or the web UI.');
  process.exit(1);
}

const API_UID = process.env.BRING_API_UID;
const API_KEY = process.env.BRING_API_KEY;
const CUSTOMER_NUMBER = process.env.BRING_CUSTOMER_NUMBER;
const env = { BRING_API_UID: API_UID, BRING_API_KEY: API_KEY };
const AUTH_HEADERS = getAuthHeaders(env);

const INVOICES_URL = 'https://www.mybring.com/invoicearchive/api/invoices';
const REPORTS_GENERATE_URL = 'https://www.mybring.com/reports/api/generate';

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: { ...AUTH_HEADERS, 'Accept': 'application/json' },
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
  const result = await httpsGet(url, { ...AUTH_HEADERS, 'Accept': 'application/xml' });
  if (result.status !== 200) {
    throw new Error(`API error ${result.status}: ${result.body.toString('utf8')}`);
  }
  return result.body.toString('utf8');
}

async function getInvoiceList() {
  // The API returns only the last 65 days by default.
  // Use fromDate/toDate to request the maximum of 365 days.
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 365);

  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const url = `${INVOICES_URL}/${CUSTOMER_NUMBER}.json?fromDate=${fmt(fromDate)}&toDate=${fmt(toDate)}`;

  const data = await fetchJson(url);
  return data.invoices || [];
}

async function generateInvoiceReport(invoiceNumber) {
  const data = await fetchJson(`${REPORTS_GENERATE_URL}/${CUSTOMER_NUMBER}/MASTER-SPECIFIED_INVOICE?invoiceNumber=${invoiceNumber}`);
  return data.statusUrl;
}

async function waitForReport(statusUrl) {
  for (let attempts = 0; attempts < 30; attempts++) {
    const data = await fetchJson(statusUrl);
    if (data.status === 'DONE') return { xmlUrl: data.xmlUrl, xlsUrl: data.xlsUrl };
    if (data.status === 'FAILED') throw new Error('Report generation failed');
    await sleep(2000);
  }
  throw new Error('Report generation timeout');
}

function parseXmlInvoice(xml) {
  const lines = [];
  for (const match of xml.matchAll(/<Line>([\s\S]*?)<\/Line>/g)) {
    const lineXml = match[1];
    const getText = (tag) => lineXml.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`))?.[1]?.trim() || '';

    const invoiceNumber = getText('InvoiceNumber');
    const shipmentNumber = getText('ShipmentNumber');

    // Skip empty lines (no invoice or shipment number)
    if (!invoiceNumber && !shipmentNumber) continue;

    lines.push({
      invoiceNumber,
      invoiceDate: getText('InvoiceDate'),
      shipmentNumber,
      packageNumber: getText('PackageNumber'),
      productCode: getText('ProductCode'),
      product: getText('Product'),
      description: getText('Description'),
      weightKg: parseFloat(getText('WeightKg')) || null,
      grossPrice: parseFloat(getText('GrossPrice')) || 0,
      discount: parseFloat(getText('Discount')) || 0,
      agreementPrice: parseFloat(getText('AgreementPrice')) || 0,
      currency: getText('CurrencyCode'),
      fromPostalCode: getText('SentFromPostalCode'),
      toPostalCode: getText('SentToPostalCode'),
      toCity: getText('SentToCity'),
      toCountry: getText('DELIVERY_COUNTRY'),
    });
  }
  return lines;
}

async function main() {
  // Ensure DB is initialized
  getDb();

  console.log('Fetching invoices...\n');
  console.log(`Customer Number: ${CUSTOMER_NUMBER}\n`);

  const invoices = await getInvoiceList();
  console.log(`Found ${invoices.length} invoices\n`);

  // Store invoice metadata in database
  const invoiceRecords = invoices.map(inv => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    totalAmount: inv.totalAmount,
    currency: inv.currency,
    specificationAvailable: inv.invoiceSpecificationAvailable,
  }));
  insertInvoices(RUN_ID, invoiceRecords);

  const allLineItems = [];

  for (const invoice of invoices) {
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
      const lines = parseXmlInvoice(xml);
      console.log(`  Found ${lines.length} line items\n`);
      allLineItems.push(...lines);
    } catch (error) {
      console.log(`  Error: ${error.message}\n`);
    }
    await sleep(1000);
  }

  console.log('\n=== SUMMARY ===\n');

  const byProduct = {};
  for (const line of allLineItems) {
    const key = `${line.productCode} - ${line.product}`;
    if (!byProduct[key]) byProduct[key] = { count: 0, totalGross: 0, totalAgreement: 0, totalDiscount: 0, weights: [] };
    byProduct[key].count++;
    byProduct[key].totalGross += line.grossPrice;
    byProduct[key].totalAgreement += line.agreementPrice;
    byProduct[key].totalDiscount += line.discount;
    if (line.weightKg) byProduct[key].weights.push(line.weightKg);
  }

  for (const [product, stats] of Object.entries(byProduct).sort((a, b) => b[1].count - a[1].count)) {
    const avgPrice = stats.count > 0 ? (stats.totalAgreement / stats.count).toFixed(2) : 0;
    const avgWeight = stats.weights.length > 0 ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) : 'N/A';
    console.log(`${product}`);
    console.log(`  Shipments: ${stats.count}`);
    console.log(`  Total paid: ${stats.totalAgreement.toFixed(2)} NOK`);
    console.log(`  Avg per shipment: ${avgPrice} NOK`);
    console.log(`  Avg weight: ${avgWeight} kg\n`);
  }

  // Write line items to database
  insertInvoiceLineItems(RUN_ID, allLineItems);
  closeDb();

  console.log(`Saved ${invoices.length} invoices and ${allLineItems.length} line items to database.`);
}

main().catch(console.error);
