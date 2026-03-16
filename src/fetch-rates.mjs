// Imperative shell for rate fetching.
// Handles HTTP calls, retries, logging, and DB persistence.
// Business logic lives in src/core/rates/*.

import { requireRunId, requireBringCredentials, sleep, fetchWithRetry, runMain, DEFAULT_ORIGIN_POSTAL_CODE } from './lib.mjs';
import { formatShippingDate } from './core/formatting.mjs';
import { loadConfig } from './config.mjs';
import { getDb, insertShippingRates, insertZones, closeDb } from './db.mjs';
import { buildRateFetchPlan, toBringRequestBody } from './core/rates/plan.mjs';
import { parseBringProductResponse, outcomeToRateRecord } from './core/rates/normalize.mjs';
import { isSuccessfulOutcome, isErrorOutcome } from './core/rates/predicates.mjs';
import { deriveZones } from './core/rates/aggregate.mjs';

const RUN_ID = requireRunId();
const { customerNumber, authHeaders } = requireBringCredentials();
const config = loadConfig();
const ORIGIN_POSTAL_CODE = process.env.BRING_ORIGIN_POSTAL_CODE || DEFAULT_ORIGIN_POSTAL_CODE;

const API_URL = 'https://api.bring.com/shippingguide/api/v2/products';
const RATE_FETCH_DELAY_MS = 50;

// ── Build fetch plan (pure) ──────────────────────────────────────────────────

const plan = buildRateFetchPlan(config);

// ── Build runtime context (impure: reads clock) ─────────────────────────────

const runtimeCtx = {
  originCountry: config.originCountry,
  originPostalCode: ORIGIN_POSTAL_CODE,
  customerNumber,
  shippingDate: formatShippingDate(new Date()),
};

// ── Execute plan (impure: HTTP, logging, sleeping) ───────────────────────────

runMain(async () => {
  getDb();

  console.log('Fetching Bring shipping rates...\n');
  console.log(`Origin: ${ORIGIN_POSTAL_CODE}, ${config.originCountry}`);
  console.log(`Customer Number: ${customerNumber}`);
  console.log(`Weight tiers: ${config.weightTiersGrams.map(w => `${w}g`).join(', ')}\n`);

  const results = [];
  let currentDestLabel = null;

  for (const [i, req] of plan.entries()) {

    // Log destination group header
    const destLabel = `${req.destination.country} - ${req.destination.desc} (Zone ${req.destination.zone})`;
    if (destLabel !== currentDestLabel) {
      currentDestLabel = destLabel;
      console.log(`\nFetching rates for ${destLabel}...`);
    }

    process.stdout.write(`  [${i + 1}/${plan.length}] ${req.service.name} @ ${req.weightG}g... `);

    try {
      const body = toBringRequestBody(req, runtimeCtx);
      const response = await fetchWithRetry(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.log(`Failed: API error ${response.status}: ${text}`);
      } else {
        const apiJson = await response.json();
        const outcome = parseBringProductResponse(apiJson, req);

        if (isSuccessfulOutcome(outcome)) {
          console.log(`${outcome.priceNok} NOK (Zone ${outcome.zone})`);
          results.push(outcomeToRateRecord(outcome));
        } else if (isErrorOutcome(outcome)) {
          console.log(`Error: ${outcome.reason}`);
        } else {
          console.log('N/A');
        }
      }
    } catch (error) {
      console.log(`Failed: ${error.message}`);
    }

    await sleep(RATE_FETCH_DELAY_MS);
  }

  // ── Aggregate and persist (pure derivation, then impure write) ─────────

  const zonesList = deriveZones(results);

  insertShippingRates(RUN_ID, results);
  insertZones(RUN_ID, zonesList);
  closeDb();

  console.log(`\n\nDone! Fetched ${results.length} rates.`);
});
