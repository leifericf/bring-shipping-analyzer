// Imperative shell for the analysis stage.
// Loads data from DB, delegates all computation to pure core,
// persists results and prints CLI summary.

import { requireRunId, runMain } from './lib.mjs';
import { loadConfig } from './config.mjs';
import { getDb, getShippingRates, getInvoiceLineItems, insertAnalysisResult, closeDb } from './db.mjs';
import { normalizeDbRate } from './core/rates/normalize.mjs';
import { normalizeDbLineItem } from './core/invoices/normalize.mjs';
import { buildAnalysisModel } from './core/analysis/model.mjs';
import { renderHtmlReport } from './core/analysis/render-html.mjs';
import { renderCliSummary } from './core/analysis/render-cli.mjs';

const RUN_ID = requireRunId();
const config = loadConfig();

runMain(async () => {
  getDb();

  console.log(`Analyzing data from run ${RUN_ID}...\n`);

  // Load from DB (impure) and normalize (pure)
  const rates = getShippingRates(RUN_ID).map(normalizeDbRate);
  const lineItems = getInvoiceLineItems(RUN_ID).map(normalizeDbLineItem);

  console.log(`Loaded ${rates.length} shipping rates from DB`);
  console.log(`Loaded ${lineItems.length} invoice line items from DB\n`);

  // Build analysis model (pure — timestamp injected from shell)
  const model = buildAnalysisModel({ rates, lineItems, config, generatedAt: new Date().toISOString() });

  // Render (pure)
  const html = renderHtmlReport(model);
  const cli = renderCliSummary(model);

  // Persist and output (impure)
  insertAnalysisResult(RUN_ID, html);
  closeDb();

  console.log(cli);
});
