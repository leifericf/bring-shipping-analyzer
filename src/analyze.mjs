import { loadConfig } from './config.mjs';
import { getDb, getShippingRates, getInvoiceLineItems, insertAnalysisResult, closeDb } from './db.mjs';

const RUN_ID = Number(process.env.RUN_ID);
if (!RUN_ID) {
  console.error('Error: RUN_ID environment variable is required. Use "npm start" or the web UI.');
  process.exit(1);
}

const config = loadConfig();
const analysis = config.analysis;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Round up to the next "nice" price ending in 9 (e.g. 59, 79, 149, 999).
 */
function nicePrice(value) {
  return Math.ceil((value - 9) / 10) * 10 + 9;
}

function fmtNok(value) {
  return value.toFixed(2) + ' kr';
}

function fmtWeight(grams) {
  const g = parseInt(grams, 10);
  return g >= 1000 ? `${g / 1000} kg` : `${g}g`;
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Invoice analysis ─────────────────────────────────────────────────────────

/**
 * Analyze invoice line items.
 * Excludes road toll and surcharge lines to count only actual shipments.
 */
function analyzeInvoices(lineItems) {
  const byProduct = {};
  const roadTolls = [];

  for (const item of lineItems) {
    const desc = item.description || '';

    if (desc.includes('Road toll')) {
      const price = parseFloat(item.agreement_price) || 0;
      if (price > 0) roadTolls.push(price);
      continue;
    }

    if (desc.includes('Surcharge')) continue;

    const key = `${item.product_code} - ${item.product}`;
    if (!byProduct[key]) {
      byProduct[key] = { count: 0, totalAgreement: 0, weights: [] };
    }

    byProduct[key].count++;
    byProduct[key].totalAgreement += parseFloat(item.agreement_price) || 0;
    if (item.weight_kg) {
      byProduct[key].weights.push(parseFloat(item.weight_kg));
    }
  }

  const avgRoadToll = roadTolls.length > 0
    ? roadTolls.reduce((a, b) => a + b, 0) / roadTolls.length
    : 0;

  return { byProduct, avgRoadToll };
}

/**
 * Group invoice line items into per-shipment profiles.
 */
function buildShipmentProfiles(lineItems) {
  const shipments = new Map();

  for (const item of lineItems) {
    const key = item.shipment_number;
    if (!shipments.has(key)) {
      shipments.set(key, {
        productCode: item.product_code,
        toPostalCode: item.to_postal_code,
        toCity: item.to_city,
        deliveryCountry: item.delivery_country || '',
        weight: null,
        totalCost: 0,
      });
    }

    const s = shipments.get(key);
    s.totalCost += parseFloat(item.agreement_price) || 0;

    const desc = item.description || '';
    if (!desc.includes('Road toll') && !desc.includes('Surcharge') && item.weight_kg) {
      s.weight = parseFloat(item.weight_kg);
    }
  }

  return shipments;
}

/**
 * Count shipments per destination zone × domestic weight bracket.
 * Groups by the same international zones used in the rate card.
 * Counts all services (not just recommended) for an accurate demand signal.
 */
function computeShipmentVolume(lineItems, intlZones) {
  const originCountry = config.originCountry;
  const shopifyBrackets = analysis.domesticShopifyBrackets;
  const shipments = buildShipmentProfiles(lineItems);

  // Initialize counts: domestic + each intl zone, per bracket
  const domesticCounts = shopifyBrackets.map(() => 0);
  const intlZoneCounts = intlZones.map(() => shopifyBrackets.map(() => 0));
  let domesticTotal = 0;
  const intlZoneTotals = intlZones.map(() => 0);

  for (const [, s] of shipments) {
    if (s.weight === null) continue;
    const bracketIdx = shopifyBrackets.findIndex(b => s.weight <= (b.maxWeight ?? Infinity));
    if (bracketIdx === -1) continue;

    if (s.deliveryCountry === originCountry) {
      domesticCounts[bracketIdx]++;
      domesticTotal++;
    } else {
      const zoneIdx = intlZones.findIndex(z => z.codes.includes(s.deliveryCountry));
      if (zoneIdx !== -1) {
        intlZoneCounts[zoneIdx][bracketIdx]++;
        intlZoneTotals[zoneIdx]++;
      }
    }
  }

  return { domesticCounts, domesticTotal, intlZoneCounts, intlZoneTotals };
}

// ── Profitability computation ────────────────────────────────────────────────

function computeProfitability(lineItems, rates, roadToll) {
  const primaryService = analysis.primaryDomesticService;
  const safeZone = analysis.safeDefaultZone;
  const vatMultiplier = analysis.vatMultiplier;

  const shipments = buildShipmentProfiles(lineItems);
  const allDomesticRates = rates.filter(r => r.country_code === config.originCountry);

  const brackets = analysis.domesticShopifyBrackets.map(b => ({
    name: b.name,
    maxWeight: b.maxWeight ?? Infinity,
    rateWeight: b.rateWeight,
    serviceId: b.serviceId || primaryService,
    shipments: [],
  }));

  for (const bracket of brackets) {
    const rate = allDomesticRates.find(r => r.service_id === bracket.serviceId && r.zone === safeZone && String(r.weight_g) === bracket.rateWeight);
    if (rate) {
      bracket.shopifyPrice = nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier));
      bracket.revenueExVat = bracket.shopifyPrice / vatMultiplier;
    }
  }

  for (const [, s] of shipments) {
    if (s.weight === null) continue;
    const bracket = brackets.find(b => s.productCode === b.serviceId && s.weight <= b.maxWeight);
    if (bracket) {
      bracket.shipments.push({
        weight: s.weight,
        totalCost: s.totalCost,
        toCity: s.toCity,
        toPostalCode: s.toPostalCode,
        revenueExVat: bracket.revenueExVat,
        margin: bracket.revenueExVat - s.totalCost,
      });
    }
  }

  const totalShipments = brackets.reduce((sum, b) => sum + b.shipments.length, 0);
  let grandTotalMargin = 0;
  let grandTotalCost = 0;
  let grandTotalRevenue = 0;

  for (const bracket of brackets) {
    const n = bracket.shipments.length;
    if (n === 0) continue;
    bracket.totalCost = bracket.shipments.reduce((sum, s) => sum + s.totalCost, 0);
    bracket.avgCost = bracket.totalCost / n;
    bracket.totalMargin = bracket.shipments.reduce((sum, s) => sum + s.margin, 0);
    bracket.avgMargin = bracket.totalMargin / n;
    const totalRevenue = bracket.revenueExVat * n;
    grandTotalMargin += bracket.totalMargin;
    grandTotalCost += bracket.totalCost;
    grandTotalRevenue += totalRevenue;
  }

  const avgMarginAll = totalShipments > 0 ? grandTotalMargin / totalShipments : 0;
  const marginPct = grandTotalRevenue > 0 ? (grandTotalMargin / grandTotalRevenue) * 100 : 0;

  const lossMaking = [];
  for (const bracket of brackets) {
    for (const s of bracket.shipments) {
      if (s.margin < 0) lossMaking.push({ ...s, bracket: bracket.name });
    }
  }
  lossMaking.sort((a, b) => a.margin - b.margin);

  return {
    brackets,
    totalShipments,
    grandTotalMargin,
    grandTotalCost,
    grandTotalRevenue,
    avgMarginAll,
    marginPct,
    lossMaking,
  };
}

// ── International zone clustering ────────────────────────────────────────────

/**
 * Auto-group international countries into shipping zones based on rate similarity.
 * Countries whose nicePrice per bracket is within `intlZoneMergeThreshold` (%)
 * of each other are merged into one zone; the zone charges the highest price.
 * Returns an array of zones sorted cheapest-first, each { codes, rates }.
 */
function clusterInternationalZones(rates, countryCodes, intlShopifyBrackets, serviceId) {
  const threshold = analysis.intlZoneMergeThreshold ?? 0.10; // default 10%

  // Compute nicePrice vector per country
  const countryPrices = [];
  for (const code of countryCodes) {
    const prices = intlShopifyBrackets.map(b => {
      const r = rates.find(r => r.country_code === code && r.service_id === serviceId && String(r.weight_g) === b.weight);
      return r ? nicePrice(Math.ceil(parseFloat(r.price_nok))) : null;
    });
    if (prices.every(p => p === null)) continue; // skip countries with no rate data
    countryPrices.push({ code, prices });
  }

  // Sort by price vector (cheapest first)
  countryPrices.sort((a, b) => {
    for (let i = 0; i < a.prices.length; i++) {
      const diff = (a.prices[i] ?? 0) - (b.prices[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  // Greedy merge: walk sorted countries, merge into current zone if within threshold
  const zones = []; // each { codes, minPrices, maxPrices }

  for (const country of countryPrices) {
    let merged = false;

    if (zones.length > 0) {
      const last = zones[zones.length - 1];
      let canMerge = true;

      for (let i = 0; i < country.prices.length; i++) {
        const cp = country.prices[i];
        if (cp === null) continue;
        const lo = Math.min(last.minPrices[i] ?? cp, cp);
        const hi = Math.max(last.maxPrices[i] ?? cp, cp);
        if (lo > 0 && (hi - lo) / lo > threshold) {
          canMerge = false;
          break;
        }
      }

      if (canMerge) {
        last.codes.push(country.code);
        for (let i = 0; i < country.prices.length; i++) {
          if (country.prices[i] !== null) {
            last.minPrices[i] = Math.min(last.minPrices[i] ?? country.prices[i], country.prices[i]);
            last.maxPrices[i] = Math.max(last.maxPrices[i] ?? country.prices[i], country.prices[i]);
          }
        }
        merged = true;
      }
    }

    if (!merged) {
      zones.push({
        codes: [country.code],
        minPrices: [...country.prices],
        maxPrices: [...country.prices],
      });
    }
  }

  // Output: customer price = max price per bracket (conservative)
  return zones.map(z => ({
    codes: z.codes,
    rates: intlShopifyBrackets.map((b, i) => ({
      name: b.name,
      price: z.maxPrices[i],
    })),
  }));
}

// ── HTML report generation ───────────────────────────────────────────────────

function generateReport(rates, invoiceAnalysis, lineItems) {
  const { byProduct, avgRoadToll } = invoiceAnalysis;
  const roadToll = Math.round(avgRoadToll * 100) / 100;

  const primaryService = analysis.primaryDomesticService;
  const cheapestIntl = analysis.cheapestInternationalService;
  const vatMultiplier = analysis.vatMultiplier;
  const vatPct = Math.round((vatMultiplier - 1) * 100);
  const safeZone = analysis.safeDefaultZone;
  const zoneCount = analysis.domesticZoneCount;
  const countryNames = config.countryNames;

  const allDomesticRates = rates.filter(r => r.country_code === config.originCountry);
  const shopifyBrackets = analysis.domesticShopifyBrackets;
  const intlShopifyBrackets = analysis.internationalShopifyBrackets;

  // Build service name lookup
  const serviceNames = {};
  for (const svc of [...config.domesticServices, ...config.internationalServices]) {
    serviceNames[svc.id] = svc.name;
  }

  // ── Compute recommended rates ────────────────────────────────────────────

  const norwayRates = shopifyBrackets.map(b => {
    const svcId = b.serviceId || primaryService;
    const rate = allDomesticRates.find(r => r.service_id === svcId && r.zone === safeZone && String(r.weight_g) === b.rateWeight);
    if (!rate) return { name: b.name, price: null, serviceId: svcId };
    return {
      name: b.name,
      price: nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier)),
      serviceId: svcId,
    };
  });

  // Auto-cluster international countries into shipping zones by rate similarity.
  // Countries that produce the same nicePrice for every bracket share a zone.
  const intlCodes = Object.keys(countryNames);
  const intlZones = clusterInternationalZones(rates, intlCodes, intlShopifyBrackets, cheapestIntl);

  // ── Compute profitability ────────────────────────────────────────────────

  const sortedProducts = Object.entries(byProduct)
    .filter(([, stats]) => stats.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  let profitability = null;
  if (lineItems.length > 0) {
    profitability = computeProfitability(lineItems, rates, roadToll);
  }

  // ── Compute shipment volume ──────────────────────────────────────────────

  const volume = lineItems.length > 0
    ? computeShipmentVolume(lineItems, intlZones)
    : null;

  // ── Render HTML ──────────────────────────────────────────────────────────

  let html = '';

  // 1) Hero: Recommended Rates
  html += renderHeroSection(
    norwayRates, intlZones, countryNames, rates,
    shopifyBrackets, intlShopifyBrackets,
    vatPct, roadToll, safeZone, primaryService, cheapestIntl,
    serviceNames, volume,
  );

  // 2) KPI tiles
  if (profitability && profitability.totalShipments > 0) {
    html += renderKpis(profitability, roadToll, sortedProducts);
  }

  // 3) Drill-down: Rate breakdown
  html += renderNorwayZoneDetails(allDomesticRates, roadToll, vatMultiplier, shopifyBrackets, primaryService, safeZone, zoneCount, serviceNames);
  html += renderInternationalDetails(rates, countryNames, cheapestIntl, serviceNames);

  // 4) Drill-down: Profitability
  if (profitability && profitability.totalShipments > 0) {
    html += renderProfitabilityDetails(profitability, safeZone, primaryService);
  }

  // 5) Drill-down: Invoice data
  if (sortedProducts.length > 0) {
    html += renderInvoiceSummary(sortedProducts);
  }

  // 6) Assumptions
  html += renderAssumptions(primaryService, cheapestIntl, vatMultiplier, roadToll, safeZone, zoneCount, shopifyBrackets, serviceNames);

  // 7) Timestamp
  html += `<p class="report-timestamp">Generated ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC')}</p>`;

  // 8) Simulator data (embedded JSON for client-side mix simulator)
  if (volume && profitability) {
    const simData = {
      vatMultiplier,
      brackets: shopifyBrackets.map((b, i) => {
        const profBracket = profitability.brackets[i];
        return {
          name: b.name,
          baselinePrice: norwayRates[i].price,
          revenueExVat: profBracket?.revenueExVat ?? null,
          avgCost: profBracket?.avgCost ?? null,
          volume: volume.domesticCounts[i],
        };
      }),
      domesticCounts: volume.domesticCounts,
    };
    html += `<script type="application/json" id="sim-data">${JSON.stringify(simData)}<\/script>`;
  }

  // ── CLI summary ──────────────────────────────────────────────────────────

  const usedServices = [...new Set(norwayRates.map(r => r.serviceId))];
  const multiService = usedServices.length > 1;

  let cli = '\n=== Recommended Shipping Rates ===\n\n';

  cli += '  Norway\n';
  for (const r of norwayRates) {
    const svcLabel = multiService ? `  [${serviceNames[r.serviceId] || r.serviceId} (${r.serviceId})]` : '';
    cli += `    ${r.name.padEnd(12)} ${r.price != null ? r.price + ' kr' : 'N/A'}${svcLabel}\n`;
  }

  for (const zone of intlZones) {
    const zoneNames = zone.codes.map(c => countryNames[c]).filter(Boolean).join(', ');
    cli += `\n  ${zoneNames}\n`;
    for (const r of zone.rates) {
      cli += `    ${r.name.padEnd(12)} ${r.price != null ? r.price + ' kr' : 'N/A'}\n`;
    }
  }

  cli += `\n  Norway: Zone ${safeZone} pricing, incl. road toll + ${vatPct}% VAT.`;
  if (multiService) {
    cli += `\n  Services: ${usedServices.map(s => `${serviceNames[s] || s} (${s})`).join(', ')}.`;
  }
  cli += `\n  International: ${cheapestIntl}, no VAT. Grouped by highest rate.\n`;

  if (profitability && profitability.totalShipments > 0) {
    const sign = profitability.avgMarginAll >= 0 ? '+' : '';
    cli += `\n  Profitability: ${profitability.totalShipments} shipments, `;
    cli += `avg margin ${sign}${fmtNok(profitability.avgMarginAll)}/parcel, `;
    cli += `${profitability.lossMaking.length} loss-making.\n`;
  }

  cli += '\n  Open the web UI for the full report with drill-down details.\n';

  return { html, cli };
}

// ── Section renderers ────────────────────────────────────────────────────────

function renderHeroSection(
  norwayRates, intlZones, countryNames, allRates,
  shopifyBrackets, intlShopifyBrackets,
  vatPct, roadToll, safeZone, primaryService, cheapestIntl,
  serviceNames, volume,
) {
  const usedServices = [...new Set(shopifyBrackets.map(b => b.serviceId || primaryService))];

  // For each international zone, compute prices at domestic bracket weights
  // so the unified table has one price per column per zone.
  const intlZoneDomesticPrices = intlZones.map(zone => {
    return shopifyBrackets.map(b => {
      const prices = zone.codes.map(code => {
        const r = allRates.find(r => r.country_code === code && r.service_id === cheapestIntl && String(r.weight_g) === b.rateWeight);
        return r ? nicePrice(Math.ceil(parseFloat(r.price_nok))) : null;
      }).filter(p => p !== null);
      return prices.length > 0 ? Math.max(...prices) : null;
    });
  });

  let h = `<div class="report-hero">`;
  h += `<h2>Recommended Shipping Rates</h2>`;
  h += `<p class="report-subtitle">${intlZones.length + 1} shipping zones (1 domestic + ${intlZones.length} international). Ready to use in your online store.</p>`;

  // ── Unified table ────────────────────────────────────────────────────────
  h += `<table class="rate-card">`;
  h += `<thead><tr><th>Destination</th>`;
  for (const b of shopifyBrackets) h += `<th>${esc(b.name)}</th>`;
  h += `</tr></thead>`;

  h += `<tbody>`;

  // Norway row
  h += `<tr><td>Norway</td>`;
  for (const r of norwayRates) {
    h += `<td>${r.price != null ? r.price + ' kr' : 'N/A'}</td>`;
  }
  h += `</tr>`;

  // International zone rows
  for (let z = 0; z < intlZones.length; z++) {
    const zone = intlZones[z];
    const zoneLabel = zone.codes.map(c => countryNames[c]).filter(Boolean).join(', ');
    h += `<tr><td>${esc(zoneLabel)}</td>`;
    for (const price of intlZoneDomesticPrices[z]) {
      h += `<td>${price != null ? price + ' kr' : 'N/A'}</td>`;
    }
    h += `</tr>`;
  }

  h += `</tbody></table>`;

  // ── Volume table (shipment counts from invoices) ─────────────────────────
  if (volume) {
    const grandTotal = volume.domesticTotal + volume.intlZoneTotals.reduce((a, b) => a + b, 0);
    if (grandTotal > 0) {
      h += `<h4>Shipment volume (from invoices)</h4>`;
      h += `<table class="rate-card volume-table">`;
      h += `<thead><tr><th>Destination</th>`;
      for (const b of shopifyBrackets) h += `<th>${esc(b.name)}</th>`;
      h += `<th>Total</th>`;
      h += `</tr></thead>`;

      h += `<tbody>`;

      // Norway row
      h += `<tr><td>Norway</td>`;
      for (const count of volume.domesticCounts) {
        h += `<td>${count || '<span class="vol-zero">0</span>'}</td>`;
      }
      h += `<td>${volume.domesticTotal}</td>`;
      h += `</tr>`;

      // International zone rows
      for (let z = 0; z < intlZones.length; z++) {
        const zone = intlZones[z];
        const zoneLabel = zone.codes.map(c => countryNames[c]).filter(Boolean).join(', ');
        h += `<tr><td>${esc(zoneLabel)}</td>`;
        for (const count of volume.intlZoneCounts[z]) {
          h += `<td>${count || '<span class="vol-zero">0</span>'}</td>`;
        }
        h += `<td>${volume.intlZoneTotals[z]}</td>`;
        h += `</tr>`;
      }

      h += `</tbody></table>`;
      h += `<p class="report-note">Parcel counts from invoice data, all services combined.</p>`;
    }
  }

  // ── Note ──────────────────────────────────────────────────────────────────
  h += `<p class="report-note">`;
  if (usedServices.length > 1) {
    const svcDescs = usedServices.map(id => {
      const brackets = shopifyBrackets.filter(b => (b.serviceId || primaryService) === id);
      const range = brackets.map(b => b.name).join(', ');
      return `${serviceNames[id] || id} (${id}): ${range}`;
    });
    h += `Norway: ${svcDescs.join('; ')}. `;
  } else {
    h += `Norway: ${esc(serviceNames[primaryService] || primaryService)} (${esc(primaryService)}). `;
  }
  h += `Zone ${esc(safeZone)} pricing, incl. road toll (~${roadToll} kr) + ${vatPct}% VAT.<br>`;
  h += `International: ${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)}), no VAT. Countries grouped by rate similarity.<br>`;
  h += `Prices rounded up to the nearest 9.`;
  h += `</p>`;

  h += `</div>`;
  return h;
}

function renderKpis(prof, roadToll, sortedProducts) {
  const totalInvoiceShipments = sortedProducts.reduce((sum, [, s]) => sum + s.count, 0);
  const lossPct = prof.totalShipments > 0
    ? ((prof.lossMaking.length / prof.totalShipments) * 100).toFixed(0)
    : '0';

  let h = `<div class="report-kpis">`;

  h += `<div class="kpi">`;
  h += `<span class="kpi-value">${totalInvoiceShipments}</span>`;
  h += `<span class="kpi-label">Shipments in invoices</span>`;
  h += `</div>`;

  h += `<div class="kpi">`;
  h += `<span class="kpi-value">${roadToll.toFixed(2)} kr</span>`;
  h += `<span class="kpi-label">Avg road toll</span>`;
  h += `</div>`;

  const marginClass = prof.marginPct >= 0 ? 'kpi-positive' : 'kpi-negative';
  h += `<div class="kpi ${marginClass}">`;
  h += `<span class="kpi-value">${prof.marginPct >= 0 ? '+' : ''}${prof.marginPct.toFixed(1)}%</span>`;
  h += `<span class="kpi-label">Overall margin</span>`;
  h += `</div>`;

  const lossClass = prof.lossMaking.length > 0 ? 'kpi-negative' : 'kpi-positive';
  h += `<div class="kpi ${lossClass}">`;
  h += `<span class="kpi-value">${lossPct}%</span>`;
  h += `<span class="kpi-label">Loss-making (${prof.lossMaking.length}/${prof.totalShipments})</span>`;
  h += `</div>`;

  h += `</div>`;
  return h;
}

function renderNorwayZoneDetails(allDomesticRates, roadToll, vatMultiplier, shopifyBrackets, primaryService, safeZone, zoneCount, serviceNames) {
  const zonesForTable = analysis.zonesForShopifyTable;
  const zoneLabels = { '1': 'Oslo', '3': 'Bergen', '7': 'Finnmark' };
  const vatPct = Math.round((vatMultiplier - 1) * 100);

  let h = `<details class="report-details">`;
  h += `<summary>Norway zone pricing &mdash; compare zones 1&ndash;${zoneCount}</summary>`;
  h += `<div class="report-details-body">`;

  // Customer rates by zone (all brackets, per-bracket service lookup)
  h += `<h4>Customer rates by zone (incl. road toll + ${vatPct}% VAT)</h4>`;
  h += `<table><thead><tr><th>Weight bracket</th>`;
  for (const z of zonesForTable) h += `<th>Zone ${z} (${zoneLabels[z] || z})</th>`;
  h += `</tr></thead><tbody>`;

  for (const bracket of shopifyBrackets) {
    const svcId = bracket.serviceId || primaryService;
    h += `<tr><td>${esc(bracket.name)}</td>`;
    for (const zone of zonesForTable) {
      const rate = allDomesticRates.find(r => r.service_id === svcId && r.zone === zone && String(r.weight_g) === bracket.rateWeight);
      if (rate) {
        const price = nicePrice(Math.ceil((parseFloat(rate.price_nok) + roadToll) * vatMultiplier));
        h += `<td>${price} kr</td>`;
      } else {
        h += `<td>N/A</td>`;
      }
    }
    h += `</tr>`;
  }
  h += `</tbody></table>`;

  // Full zone pricing per service
  const usedServices = [...new Set(shopifyBrackets.map(b => b.serviceId || primaryService))];

  for (const svcId of usedServices) {
    const svcName = serviceNames[svcId] || svcId;
    const svcBrackets = shopifyBrackets.filter(b => (b.serviceId || primaryService) === svcId);
    const svcWeights = svcBrackets.map(b => b.rateWeight);

    h += `<h4>${esc(svcName)} (${esc(svcId)}) &mdash; ex VAT, ex road toll</h4>`;
    h += `<table><thead><tr><th>Zone</th>`;
    for (const w of svcWeights) h += `<th>${fmtWeight(w)}</th>`;
    h += `</tr></thead><tbody>`;

    for (let zone = 1; zone <= zoneCount; zone++) {
      const z = String(zone);
      h += `<tr><td>${zone}</td>`;
      for (const w of svcWeights) {
        const rate = allDomesticRates.find(r => r.service_id === svcId && r.zone === z && String(r.weight_g) === w);
        h += `<td>${rate ? fmtNok(parseFloat(rate.price_nok)) : 'N/A'}</td>`;
      }
      h += `</tr>`;
    }
    h += `</tbody></table>`;
  }

  h += `<p class="report-note">Zone 1 (Oslo) is cheapest. Zone ${zoneCount} (Finnmark) costs roughly 2&times; Zone 1. The recommended rates above use Zone ${safeZone} as a safe middle ground.</p>`;

  h += `</div></details>`;
  return h;
}

function renderInternationalDetails(rates, countryNames, cheapestIntl, serviceNames) {
  const intlWeightColumns = analysis.internationalWeightColumns;

  let h = `<details class="report-details">`;
  h += `<summary>International rates per country &mdash; ${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)})</summary>`;
  h += `<div class="report-details-body">`;

  h += `<table><thead><tr><th>Country</th>`;
  for (const w of intlWeightColumns) h += `<th>${fmtWeight(w)}</th>`;
  h += `</tr></thead><tbody>`;

  for (const [code, name] of Object.entries(countryNames)) {
    h += `<tr><td>${esc(name)}</td>`;
    for (const w of intlWeightColumns) {
      const rate = rates.find(r => r.country_code === code && r.service_id === cheapestIntl && String(r.weight_g) === w);
      h += `<td>${rate ? Math.ceil(parseFloat(rate.price_nok)) : 'N/A'}</td>`;
    }
    h += `</tr>`;
  }
  h += `</tbody></table>`;

  h += `<p class="report-note">Raw agreement prices in kr, no VAT. These are the actual rates from your Bring contract.</p>`;

  h += `</div></details>`;
  return h;
}

function renderProfitabilityDetails(prof, safeZone, primaryService) {
  let h = `<details class="report-details">`;
  h += `<summary>Profitability analysis &mdash; ${prof.totalShipments} shipments</summary>`;
  h += `<div class="report-details-body">`;

  h += `<p>Based on ${prof.totalShipments} domestic shipments from invoice data, `;
  h += `projected against the recommended customer rates (Zone ${esc(safeZone)} pricing). `;
  h += `Brackets with 0 shipments have no historical data yet.</p>`;

  // Per-bracket summary
  h += `<h4>Per-bracket summary</h4>`;
  h += `<table><thead><tr>`;
  h += `<th>Bracket</th><th>Qty</th><th>Avg cost</th><th>Rate</th><th>Rev. ex VAT</th><th>Avg margin</th><th>Total margin</th>`;
  h += `</tr></thead><tbody>`;

  for (const bracket of prof.brackets) {
    const n = bracket.shipments.length;
    if (n === 0) {
      h += `<tr><td>${esc(bracket.name)}</td><td>0</td><td>&mdash;</td>`;
      h += `<td>${bracket.shopifyPrice != null ? bracket.shopifyPrice + ' kr' : 'N/A'}</td>`;
      h += `<td>${bracket.revenueExVat != null ? fmtNok(bracket.revenueExVat) : 'N/A'}</td>`;
      h += `<td>&mdash;</td><td>&mdash;</td></tr>`;
      continue;
    }

    const marginCls = bracket.avgMargin >= 0 ? 'margin-positive' : 'margin-negative';
    const sign = bracket.avgMargin >= 0 ? '+' : '';
    const totalSign = bracket.totalMargin >= 0 ? '+' : '';

    h += `<tr>`;
    h += `<td>${esc(bracket.name)}</td>`;
    h += `<td>${n}</td>`;
    h += `<td>${fmtNok(bracket.avgCost)}</td>`;
    h += `<td>${bracket.shopifyPrice} kr</td>`;
    h += `<td>${fmtNok(bracket.revenueExVat)}</td>`;
    h += `<td class="${marginCls}">${sign}${fmtNok(bracket.avgMargin)}</td>`;
    h += `<td class="${marginCls}">${totalSign}${fmtNok(bracket.totalMargin)}</td>`;
    h += `</tr>`;
  }

  // Total row
  const totalCls = prof.grandTotalMargin >= 0 ? 'margin-positive' : 'margin-negative';
  const avgSign = prof.avgMarginAll >= 0 ? '+' : '';
  const totalSign = prof.grandTotalMargin >= 0 ? '+' : '';

  h += `<tr class="total-row">`;
  h += `<td><strong>Total</strong></td>`;
  h += `<td><strong>${prof.totalShipments}</strong></td>`;
  h += `<td></td><td></td><td></td>`;
  h += `<td class="${totalCls}"><strong>${avgSign}${fmtNok(prof.avgMarginAll)}/parcel</strong></td>`;
  h += `<td class="${totalCls}"><strong>${totalSign}${fmtNok(prof.grandTotalMargin)}</strong></td>`;
  h += `</tr>`;
  h += `</tbody></table>`;

  h += `<p class="report-note">Overall margin: ${prof.marginPct.toFixed(1)}% of revenue ex VAT.</p>`;

  // Worst case per bracket
  h += `<h4>Worst-case shipment per bracket</h4>`;
  h += `<p class="report-note">The most expensive shipment in each bracket &mdash; your floor for margin evaluation.</p>`;
  h += `<table><thead><tr><th>Bracket</th><th>City</th><th>Weight</th><th>Cost</th><th>Rev. ex VAT</th><th>Margin</th></tr></thead><tbody>`;

  for (const bracket of prof.brackets) {
    if (bracket.shipments.length === 0) continue;
    const worst = bracket.shipments.reduce((a, b) => a.totalCost > b.totalCost ? a : b);
    const cls = worst.margin >= 0 ? 'margin-positive' : 'margin-negative';
    const sign = worst.margin >= 0 ? '+' : '';
    h += `<tr>`;
    h += `<td>${esc(bracket.name)}</td>`;
    h += `<td>${esc(worst.toCity)}</td>`;
    h += `<td>${worst.weight} kg</td>`;
    h += `<td>${fmtNok(worst.totalCost)}</td>`;
    h += `<td>${fmtNok(bracket.revenueExVat)}</td>`;
    h += `<td class="${cls}">${sign}${fmtNok(worst.margin)}</td>`;
    h += `</tr>`;
  }
  h += `</tbody></table>`;

  // Loss-making shipments
  if (prof.lossMaking.length > 0) {
    h += `<h4>Loss-making shipments (${prof.lossMaking.length} of ${prof.totalShipments})</h4>`;

    const topN = 10;
    const showInline = prof.lossMaking.slice(0, topN);
    const hasMore = prof.lossMaking.length > topN;

    h += `<p class="report-note">Shipments where Zone ${safeZone} pricing doesn't fully cover costs. Showing worst ${Math.min(topN, prof.lossMaking.length)}:</p>`;
    h += renderLossTable(showInline);

    if (hasMore) {
      h += `<details class="report-details-nested">`;
      h += `<summary>Show all ${prof.lossMaking.length} loss-making shipments</summary>`;
      h += `<div class="report-details-body">`;
      h += renderLossTable(prof.lossMaking);
      h += `</div></details>`;
    }
  } else {
    h += `<p>All ${prof.totalShipments} shipments would be profitable at the recommended rates.</p>`;
  }

  h += `</div></details>`;
  return h;
}

function renderLossTable(items) {
  let h = `<table><thead><tr>`;
  h += `<th>Bracket</th><th>City</th><th>Postal</th><th>Weight</th><th>Cost</th><th>Rev.</th><th>Loss</th>`;
  h += `</tr></thead><tbody>`;

  for (const s of items) {
    h += `<tr>`;
    h += `<td>${esc(s.bracket)}</td>`;
    h += `<td>${esc(s.toCity)}</td>`;
    h += `<td>${esc(s.toPostalCode)}</td>`;
    h += `<td>${s.weight} kg</td>`;
    h += `<td>${s.totalCost.toFixed(0)}</td>`;
    h += `<td>${s.revenueExVat.toFixed(0)}</td>`;
    h += `<td class="margin-negative">${s.margin.toFixed(0)}</td>`;
    h += `</tr>`;
  }

  h += `</tbody></table>`;
  return h;
}

function renderInvoiceSummary(sortedProducts) {
  let h = `<details class="report-details">`;
  h += `<summary>Invoice data &mdash; shipments by product</summary>`;
  h += `<div class="report-details-body">`;

  h += `<table><thead><tr>`;
  h += `<th>Product</th><th>Shipments</th><th>Total paid</th><th>Avg per shipment</th><th>Avg weight</th>`;
  h += `</tr></thead><tbody>`;

  for (const [product, stats] of sortedProducts) {
    const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
    const avgWeight = stats.weights.length > 0
      ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) + ' kg'
      : 'N/A';

    h += `<tr>`;
    h += `<td>${esc(product)}</td>`;
    h += `<td>${stats.count}</td>`;
    h += `<td>${fmtNok(stats.totalAgreement)}</td>`;
    h += `<td>${avgPrice} kr</td>`;
    h += `<td>${avgWeight}</td>`;
    h += `</tr>`;
  }

  h += `</tbody></table>`;
  h += `</div></details>`;
  return h;
}

function renderAssumptions(primaryService, cheapestIntl, vatMultiplier, roadToll, safeZone, zoneCount, shopifyBrackets, serviceNames) {
  const vatPct = Math.round((vatMultiplier - 1) * 100);
  const usedServices = [...new Set(shopifyBrackets.map(b => b.serviceId || primaryService))];

  let h = `<details class="report-details">`;
  h += `<summary>Assumptions &amp; methodology</summary>`;
  h += `<div class="report-details-body">`;

  h += `<table class="assumptions-table"><tbody>`;

  if (usedServices.length > 1) {
    const svcDescs = usedServices.map(id => {
      const brackets = shopifyBrackets.filter(b => (b.serviceId || primaryService) === id);
      const range = brackets.map(b => b.name).join(', ');
      return `${serviceNames[id] || id} (${id}): ${range}`;
    });
    h += `<tr><th>Domestic services</th><td>${svcDescs.map(esc).join('<br>')}</td></tr>`;
  } else {
    h += `<tr><th>Domestic service</th><td>${esc(serviceNames[primaryService] || primaryService)} (${esc(primaryService)})</td></tr>`;
  }

  h += `<tr><th>International service</th><td>${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)})</td></tr>`;
  h += `<tr><th>VAT</th><td>${vatPct}% (Norway only, added to customer-facing rates)</td></tr>`;
  h += `<tr><th>Road toll</th><td>~${roadToll} kr per shipment (avg from invoices, Norway only)</td></tr>`;
  h += `<tr><th>Norway pricing zone</th><td>Zone ${esc(safeZone)} &mdash; covers most of the country. Zone 1 (Oslo) is cheapest, Zone ${zoneCount} (Finnmark) ~2&times; Zone 1</td></tr>`;
  h += `<tr><th>Price rounding</th><td>Rounded up to next "nice" price ending in 9</td></tr>`;
  const mergePct = Math.round((analysis.intlZoneMergeThreshold ?? 0.10) * 100);
  h += `<tr><th>International grouping</th><td>Countries with rates within ${mergePct}% of each other are merged into one zone. The zone charges the highest rate so you never lose money. Adjust <code>intlZoneMergeThreshold</code> in the account config to change.</td></tr>`;
  h += `<tr><th>Zone caveat</th><td>Zone numbers can differ per service for the same postal code</td></tr>`;
  h += `</tbody></table>`;

  h += `</div></details>`;
  return h;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  getDb();

  console.log(`Analyzing data from run ${RUN_ID}...\n`);

  const rates = getShippingRates(RUN_ID).map(r => ({
    ...r,
    zone: r.zone != null ? String(r.zone).replace(/\.0$/, '') : '',
    weight_g: String(r.weight_g),
    price_nok: String(r.price_nok),
  }));
  const lineItems = getInvoiceLineItems(RUN_ID).map(r => ({
    ...r,
    weight_kg: r.weight_kg != null ? String(r.weight_kg) : '',
    agreement_price: String(r.agreement_price ?? 0),
    gross_price: String(r.gross_price ?? 0),
    discount: String(r.discount ?? 0),
  }));

  console.log(`Loaded ${rates.length} shipping rates from DB`);
  console.log(`Loaded ${lineItems.length} invoice line items from DB\n`);

  const invoiceAnalysis = analyzeInvoices(lineItems);
  const { html, cli } = generateReport(rates, invoiceAnalysis, lineItems);

  // Store HTML in database (column name is results_markdown for compat, content is now HTML)
  insertAnalysisResult(RUN_ID, html);
  closeDb();

  // Print compact summary for CLI users
  console.log(cli);
}

main().catch(console.error);
