import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { httpsGet, DEFAULT_ORIGIN_POSTAL_CODE } from './lib.mjs';
import { fmtDate, fmtStatus } from './core/formatting.mjs';
import { validateConfig } from './core/config/validate.mjs';
import { checkForFlaggedCountries, FLAGGED_COUNTRIES, RISK_LABELS } from './core/flagged-countries.mjs';
import { normalizeDbRate } from './core/rates/normalize.mjs';
import { normalizeDbLineItem } from './core/invoices/normalize.mjs';
import { buildAnalysisModel } from './core/analysis/model.mjs';
import { renderHtmlReport } from './core/analysis/render-html.mjs';
import { DEFAULT_CONFIG_PATH } from './config.mjs';
import {
  getDb, closeDb,
  getAllAccounts, getAccount, createAccount, updateAccount, updateAccountConfig, deleteAccount, setAccountDemoFlag,
  createRun as dbCreateRun, getRun, deleteRun, getRunsForAccount, getRecentRuns,
  getAnalysisResult, getShippingRates, getInvoiceLineItems,
  getInvoices,
} from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// Lightweight cookie parsing (no extra dependency)
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const [k, ...v] = pair.trim().split('=');
      if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
    }
  }
  next();
});

/**
 * Render a view inside the layout.
 */
function render(res, view, locals = {}) {
  const demoMode = res.req.cookies?.demo_mode === '1';
  const allLocals = { ...locals, fmtDate, fmtStatus, currentPath: res.req.path, demoMode };
  res.render(view, allLocals, (err, body) => {
    if (err) { console.error(err); return res.status(500).send('Render error'); }
    res.render('layout', { ...allLocals, body });
  });
}

/**
 * Return a copy of a run object enriched with its account name.
 */
function enrichRunWithAccountName(run) {
  if (!run.account_id) return run;
  const account = getAccount(run.account_id);
  return { ...run, account_name: account ? account.name : null };
}

/**
 * Load the default config.json as a parsed object (for new accounts).
 * Throws a descriptive error if the file is missing or invalid.
 */
function getDefaultConfig() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load default config from ${DEFAULT_CONFIG_PATH}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  const demoMode = req.cookies.demo_mode === '1';
  const accounts = getAllAccounts({ demoOnly: demoMode });
  const recentRuns = getRecentRuns(20, { demoOnly: demoMode });
  render(res, 'dashboard', { title: 'Dashboard', accounts, recentRuns, demoMode });
});

app.post('/demo-mode/enable', (_req, res) => {
  res.cookie('demo_mode', '1', { httpOnly: true, sameSite: 'lax' });
  res.redirect('/');
});

app.post('/demo-mode/disable', (_req, res) => {
  res.clearCookie('demo_mode');
  res.redirect('/');
});

app.post('/accounts/:id/mark-demo', (req, res) => {
  const id = Number(req.params.id);
  setAccountDemoFlag(id, true);
  res.redirect(req.headers.referer || `/accounts/${id}/config`);
});

app.post('/accounts/:id/unmark-demo', (req, res) => {
  const id = Number(req.params.id);
  setAccountDemoFlag(id, false);
  res.redirect(req.headers.referer || `/accounts/${id}/config`);
});

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

app.get('/accounts/new', (req, res) => {
  render(res, 'account-form', { title: 'New Account', editing: false, account: {} });
});

app.post('/accounts', (req, res) => {
  const { name, api_uid, api_key, customer_number, origin_postal_code } = req.body;
  const config = getDefaultConfig();
  const id = createAccount(name, api_uid, api_key, customer_number, origin_postal_code || DEFAULT_ORIGIN_POSTAL_CODE, config);
  res.redirect(`/accounts/${id}/runs`);
});

app.get('/accounts/:id/edit', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');
  render(res, 'account-form', { title: 'Edit Account', editing: true, account });
});

app.post('/accounts/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, api_uid, api_key, customer_number, origin_postal_code } = req.body;
  updateAccount(id, name, api_uid, api_key, customer_number, origin_postal_code || DEFAULT_ORIGIN_POSTAL_CODE);
  res.redirect(`/accounts/${id}/runs`);
});

app.post('/accounts/:id/delete', (req, res) => {
  deleteAccount(Number(req.params.id));
  res.redirect('/');
});

// ---------------------------------------------------------------------------
// Account config
// ---------------------------------------------------------------------------

app.get('/accounts/:id/config', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');

  const config = JSON.parse(account.config);
  const configJson = JSON.stringify(config, null, 2);
  render(res, 'account-config', {
    title: 'Config: ' + account.name, account, configJson,
    flaggedCountries: FLAGGED_COUNTRIES, riskLabels: RISK_LABELS,
  });
});

app.post('/accounts/:id/config', (req, res) => {
  const id = Number(req.params.id);
  const account = getAccount(id);
  if (!account) return res.status(404).send('Account not found');

  const flaggedLocals = { flaggedCountries: FLAGGED_COUNTRIES, riskLabels: RISK_LABELS };

  let config;
  try {
    config = JSON.parse(req.body.config);
  } catch (err) {
    const configJson = req.body.config;
    return render(res, 'account-config', {
      title: 'Config: ' + account.name, account, configJson,
      flash: 'Invalid JSON: ' + err.message, ...flaggedLocals,
    });
  }

  const validation = validateConfig(config);
  if (!validation.ok) {
    const configJson = JSON.stringify(config, null, 2);
    return render(res, 'account-config', {
      title: 'Config: ' + account.name, account, configJson,
      flash: 'Invalid config: ' + validation.errors.join('; '), ...flaggedLocals,
    });
  }

  updateAccountConfig(id, config);

  // Check for flagged countries — warn but still save
  const flaggedInConfig = checkForFlaggedCountries((config.destinations || []).map(d => d.code));
  if (flaggedInConfig.length > 0) {
    const warnings = flaggedInConfig.map(f => `${f.country} (${f.code}): ${f.risk} risk`);
    const configJson = JSON.stringify(config, null, 2);
    return render(res, 'account-config', {
      title: 'Config: ' + account.name, account, configJson,
      flash: 'Saved, but config contains flagged countries: ' + warnings.join('; '),
      flashType: 'warning', ...flaggedLocals,
    });
  }

  res.redirect(`/accounts/${id}/runs`);
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

app.get('/accounts/:id/runs', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');
  const runs = getRunsForAccount(account.id);
  render(res, 'runs', { title: account.name, account, runs });
});

app.post('/accounts/:id/runs', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).send('Account not found');

  const config = JSON.parse(account.config);

  // Create run record
  const runId = dbCreateRun(account.customer_number, account.origin_postal_code, config, account.id);

  // Write temp config file for this run
  const configPath = join(tmpdir(), `bring-config-${runId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config));

  // Spawn pipeline in background.
  // Uses process.execPath instead of 'node' so it works inside packaged
  // Electron apps.  ELECTRON_RUN_AS_NODE=1 is harmless under plain Node.
  const child = spawn(process.execPath, [join(__dirname, 'run.mjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      BRING_API_UID: account.api_uid,
      BRING_API_KEY: account.api_key,
      BRING_CUSTOMER_NUMBER: account.customer_number,
      BRING_ORIGIN_POSTAL_CODE: account.origin_postal_code,
      CONFIG_PATH: configPath,
      RUN_ID: String(runId),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log output to console
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));

  // Clean up temp config when done
  child.on('close', () => {
    try { fs.unlinkSync(configPath); } catch (e) { console.warn(`Cleanup: ${e.message}`); }
  });

  res.redirect(`/runs/${runId}`);
});

// ---------------------------------------------------------------------------
// Run detail + status polling
// ---------------------------------------------------------------------------

app.get('/runs/:id', (req, res) => {
  let run = getRun(Number(req.params.id));
  if (!run) return res.status(404).send('Run not found');
  run = enrichRunWithAccountName(run);

  let resultsHtml = null;
  if (run.status === 'completed') {
    // Regenerate report from stored data + current config so config
    // changes (e.g. VAT toggle) take effect without re-running.
    try {
      const account = run.account_id ? getAccount(run.account_id) : null;
      const configResult = account
        ? validateConfig(JSON.parse(account.config))
        : validateConfig(JSON.parse(run.config_snapshot));

      if (configResult.ok) {
        const rates = getShippingRates(run.id).map(normalizeDbRate);
        const lineItems = getInvoiceLineItems(run.id).map(normalizeDbLineItem);
        const model = buildAnalysisModel({ rates, lineItems, config: configResult.value, generatedAt: new Date().toISOString() });
        resultsHtml = renderHtmlReport(model);
      } else {
        console.warn('Report regeneration: config validation failed:', configResult.errors);
      }
    } catch (err) {
      console.error('Report regeneration failed, using cached:', err.message, err.stack);
    }

    if (!resultsHtml) {
      const result = getAnalysisResult(run.id);
      if (result) resultsHtml = result.results_html;
    }
  }

  // Check if this run has invoices
  const invoices = run.status === 'completed' ? getInvoices(run.id) : [];

  render(res, 'run-detail', { title: 'Run #' + run.id, run, resultsHtml, invoiceCount: invoices.length });
});

app.post('/runs/:id/delete', (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) return res.status(404).send('Run not found');
  const accountId = run.account_id;
  deleteRun(run.id);
  res.redirect(accountId ? `/accounts/${accountId}/runs` : '/');
});

app.get('/api/runs/:id/status', (req, res) => {
  const run = getRun(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json({ status: run.status });
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

app.get('/runs/:id/invoices', (req, res) => {
  let run = getRun(Number(req.params.id));
  if (!run) return res.status(404).send('Run not found');

  run = enrichRunWithAccountName(run);

  const invoices = getInvoices(run.id);
  render(res, 'invoices', { title: 'Invoices — Run #' + run.id, run, invoices });
});

app.get('/runs/:runId/invoices/:invoiceNumber/pdf', async (req, res) => {
  const run = getRun(Number(req.params.runId));
  if (!run) return res.status(404).send('Run not found');

  // Get the account's API credentials for authentication
  if (!run.account_id) {
    return res.status(400).send('Cannot download PDF: run has no associated account (CLI runs do not store credentials).');
  }

  const account = getAccount(run.account_id);
  if (!account) return res.status(404).send('Account not found');

  const invoiceNumber = req.params.invoiceNumber;
  const pdfUrl = `https://www.mybring.com/invoicearchive/pdf/${account.customer_number}/${invoiceNumber}.pdf`;

  try {
    const result = await httpsGet(pdfUrl, {
      'X-Mybring-API-Uid': account.api_uid,
      'X-Mybring-API-Key': account.api_key,
    });

    if (result.status !== 200) {
      return res.status(result.status).send(`Failed to download PDF: ${result.status}`);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);
    res.send(result.body);
  } catch (error) {
    console.error(`PDF proxy error: ${error.message}`);
    res.status(500).send('Failed to download PDF from Bring');
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

/**
 * Start the Express server.
 * @param {number} [port] - Port to listen on (defaults to PORT env or 3000)
 * @returns {Promise<{ server: import('http').Server, port: number }>}
 */
export function startServer(port) {
  port = port || PORT;
  getDb();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`\nBring Shipping Advisor — Web UI`);
      console.log(`Running at http://localhost:${port}\n`);
      resolve({ server, port: Number(port) });
    });
    server.on('error', reject);
  });
}

// Auto-start when run directly (not managed by Electron)
if (!process.env.ELECTRON_MANAGED) {
  startServer().catch(err => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
  process.on('SIGINT', () => { closeDb(); process.exit(0); });
  process.on('SIGTERM', () => { closeDb(); process.exit(0); });
}
