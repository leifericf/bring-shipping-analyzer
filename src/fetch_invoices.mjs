import fs from 'fs';
import { join } from 'path';
import { loadEnv, getOutputDir, getAuthHeaders, sleep, fetchWithRetry, httpsGet, csvRow } from './lib.mjs';
import { insertInvoiceLineItems, closeDb } from './db.mjs';

const env = loadEnv();

const CUSTOMER_NUMBER = env.BRING_CUSTOMER_NUMBER;
const OUTPUT_DIR = getOutputDir(CUSTOMER_NUMBER);
const AUTH_HEADERS = getAuthHeaders(env);
const RUN_ID = process.env.RUN_ID ? Number(process.env.RUN_ID) : null;

const INVOICES_URL = 'https://www.mybring.com/invoicearchive/api/invoices';
const INVOICE_PDF_URL = 'https://www.mybring.com/invoicearchive/pdf';
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

async function downloadPdf(invoiceNumber, outputPath) {
  const url = `${INVOICE_PDF_URL}/${CUSTOMER_NUMBER}/${invoiceNumber}.pdf`;
  const result = await httpsGet(url, AUTH_HEADERS);
  if (result.status !== 200) {
    throw new Error(`PDF download failed: ${result.status}`);
  }
  fs.writeFileSync(outputPath, result.body);
}

async function getInvoices() {
  const data = await fetchJson(`${INVOICES_URL}/${CUSTOMER_NUMBER}.json`);
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
  fs.mkdirSync(join(OUTPUT_DIR, 'invoices'), { recursive: true });

  console.log('Fetching invoices...\n');
  console.log(`Customer Number: ${CUSTOMER_NUMBER}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const invoices = await getInvoices();
  console.log(`Found ${invoices.length} invoices\n`);

  const allLineItems = [];

  for (const invoice of invoices) {
    console.log(`Processing invoice ${invoice.invoiceNumber} (${invoice.invoiceDate})...`);
    console.log(`  Amount: ${invoice.totalAmount} ${invoice.currency}`);

    // Download PDF
    console.log('  Downloading PDF...');
    const pdfPath = join(OUTPUT_DIR, 'invoices', `${invoice.invoiceNumber}.pdf`);
    try {
      await downloadPdf(invoice.invoiceNumber, pdfPath);
      console.log(`  Saved to invoices/${invoice.invoiceNumber}.pdf`);
    } catch (error) {
      console.log(`  PDF download failed: ${error.message}`);
    }

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

  const csvHeader = 'invoice_number,invoice_date,shipment_number,package_number,product_code,product,description,weight_kg,gross_price,discount,agreement_price,currency,from_postal_code,to_postal_code,to_city,to_country';
  const csvRows = allLineItems.map(l =>
    csvRow([
      l.invoiceNumber, l.invoiceDate, l.shipmentNumber, l.packageNumber,
      l.productCode, l.product, l.description, l.weightKg || '',
      l.grossPrice, l.discount, l.agreementPrice, l.currency,
      l.fromPostalCode, l.toPostalCode, l.toCity, l.toCountry,
    ])
  );
  fs.writeFileSync(join(OUTPUT_DIR, 'invoice_line_items.csv'), [csvHeader, ...csvRows].join('\n'));

  // Write to database if we have a run ID
  if (RUN_ID) {
    insertInvoiceLineItems(RUN_ID, allLineItems);
    closeDb();
  }

  console.log(`\nSaved ${allLineItems.length} line items to ${OUTPUT_DIR}/invoice_line_items.csv`);
}

main().catch(console.error);
