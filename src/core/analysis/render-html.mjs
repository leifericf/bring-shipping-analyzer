// Pure HTML report renderer.
// Input: AnalysisModel -> Output: HTML string.
// No I/O, no DB, no side effects.

import { domesticCustomerPrice, fmtNok, fmtWeight, esc, fmtZoneLabel } from '../formatting.mjs';

/**
 * Render the complete HTML report from an AnalysisModel.
 *
 * @param {object} model - AnalysisModel from buildAnalysisModel
 * @returns {string} HTML string
 */
export function renderHtmlReport(model) {
  const sections = [
    renderHeroSection(model),
    model.profitability && model.profitability.totalShipments > 0
      ? renderKpis(model)
      : '',
    renderNorwayZoneDetails(model),
    renderInternationalDetails(model),
    model.profitability && model.profitability.totalShipments > 0
      ? renderProfitabilityDetails(model)
      : '',
    model.sortedProducts.length > 0
      ? renderInvoiceSummary(model)
      : '',
    renderAssumptions(model),
    renderTimestamp(model.generatedAt),
    renderSimulatorData(model),
  ];

  return sections.filter(Boolean).join('');
}

// ── Hero section ─────────────────────────────────────────────────────────────

function renderHeroSection(model) {
  const {
    norwayRates, intlZones, intlZoneDomesticPrices, countryNames,
    shopifyBrackets, volume,
  } = model;

  const parts = [];
  parts.push(`<div class="report-hero">`);
  parts.push(`<h2>Recommended Shipping Rates</h2>`);
  parts.push(`<p class="report-subtitle">${intlZones.length + 1} shipping zones (1 domestic + ${intlZones.length} international). Ready to use in your online store.</p>`);

  // Unified rate table
  const headerCells = shopifyBrackets.map(b => `<th>${esc(b.name)}</th>`).join('');
  parts.push(`<table class="rate-card">`);
  parts.push(`<thead><tr><th>Destination</th>${headerCells}</tr></thead>`);
  parts.push(`<tbody>`);

  // Norway row
  const norwayCells = norwayRates.map(r => `<td>${r.price != null ? r.price + ' kr' : 'N/A'}</td>`).join('');
  parts.push(`<tr><td>Norway</td>${norwayCells}</tr>`);

  // International zone rows
  intlZones.forEach((zone, z) => {
    const cells = intlZoneDomesticPrices[z].map(price => `<td>${price != null ? price + ' kr' : 'N/A'}</td>`).join('');
    parts.push(`<tr><td>${esc(fmtZoneLabel(zone, countryNames))}</td>${cells}</tr>`);
  });

  parts.push(`</tbody></table>`);

  // Volume table
  if (volume) {
    const grandTotal = volume.domesticTotal + volume.intlZoneTotals.reduce((a, b) => a + b, 0);
    if (grandTotal > 0) {
      parts.push(renderVolumeTable(model, volume, intlZones));
    }
  }

  // Note
  parts.push(renderHeroNote(model));
  parts.push(`</div>`);

  return parts.join('');
}

function renderVolumeTable(model, volume, intlZones) {
  const { shopifyBrackets, countryNames } = model;
  const parts = [];

  const headerCells = shopifyBrackets.map(b => `<th>${esc(b.name)}</th>`).join('');
  parts.push(`<h4>Shipment volume (from invoices)</h4>`);
  parts.push(`<table class="rate-card volume-table">`);
  parts.push(`<thead><tr><th>Destination</th>${headerCells}<th>Total</th></tr></thead>`);
  parts.push(`<tbody>`);

  // Norway row
  const norwayCells = volume.domesticCounts.map(count => `<td>${count || '<span class="vol-zero">0</span>'}</td>`).join('');
  parts.push(`<tr><td>Norway</td>${norwayCells}<td>${volume.domesticTotal}</td></tr>`);

  // International zone rows
  intlZones.forEach((zone, z) => {
    const cells = volume.intlZoneCounts[z].map(count => `<td>${count || '<span class="vol-zero">0</span>'}</td>`).join('');
    parts.push(`<tr><td>${esc(fmtZoneLabel(zone, countryNames))}</td>${cells}<td>${volume.intlZoneTotals[z]}</td></tr>`);
  });

  parts.push(`</tbody></table>`);
  parts.push(`<p class="report-note">Parcel counts from invoice data, all services combined.</p>`);

  return parts.join('');
}

function renderHeroNote(model) {
  const { serviceDescriptions, avgRoadToll, vatPct, safeZone, cheapestIntl, serviceNames } = model;

  let note = `<p class="report-note">`;
  if (serviceDescriptions.length > 1) {
    const svcDescs = serviceDescriptions.map(s => `${s.name} (${s.id}): ${s.range}`);
    note += `Norway: ${svcDescs.join('; ')}. `;
  } else {
    const s = serviceDescriptions[0];
    note += `Norway: ${esc(s.name)} (${esc(s.id)}). `;
  }
  note += `Zone ${esc(safeZone)} pricing, incl. road toll (~${avgRoadToll} kr) + ${vatPct}% VAT.<br>`;
  note += `International: ${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)}), no VAT. Countries grouped by rate similarity.<br>`;
  note += `Prices rounded up to the nearest 9.`;
  note += `</p>`;

  return note;
}

// ── KPI tiles ────────────────────────────────────────────────────────────────

function renderKpis(model) {
  const { profitability: prof, avgRoadToll, sortedProducts } = model;
  const totalInvoiceShipments = sortedProducts.reduce((sum, [, s]) => sum + s.count, 0);
  const lossPct = prof.totalShipments > 0
    ? ((prof.lossMaking.length / prof.totalShipments) * 100).toFixed(0)
    : '0';

  const tiles = [
    { value: totalInvoiceShipments, label: 'Shipments in invoices' },
    {
      value: prof.totalShipments,
      label: 'Matched to brackets',
      note: prof.skipped.total > 0 ? `${prof.skipped.total} excluded` : null,
    },
    { value: `${avgRoadToll.toFixed(2)} kr`, label: 'Avg road toll' },
    {
      value: `${prof.marginPct >= 0 ? '+' : ''}${prof.marginPct.toFixed(1)}%`,
      label: 'Overall margin',
      cls: prof.marginPct >= 0 ? 'kpi-positive' : 'kpi-negative',
    },
    {
      value: `${lossPct}%`,
      label: `Loss-making (${prof.lossMaking.length}/${prof.totalShipments})`,
      cls: prof.lossMaking.length > 0 ? 'kpi-negative' : 'kpi-positive',
    },
  ];

  const tileHtml = tiles.map(t => {
    const cls = t.cls ? ` ${t.cls}` : '';
    const note = t.note ? `<span class="kpi-note">${t.note}</span>` : '';
    return `<div class="kpi${cls}"><span class="kpi-value">${t.value}</span><span class="kpi-label">${t.label}</span>${note}</div>`;
  }).join('');

  return `<div class="report-kpis">${tileHtml}</div>`;
}

// ── Norway zone details ──────────────────────────────────────────────────────

function renderNorwayZoneDetails(model) {
  const { rateLookup, avgRoadToll, vatMultiplier, vatPct, usedServices, shopifyBrackets, primaryService, safeZone, zoneCount, zoneLabels, serviceNames, analysis } = model;
  const zonesForTable = analysis.zonesForShopifyTable;

  const parts = [];
  parts.push(`<details class="report-details">`);
  parts.push(`<summary>Norway zone pricing &mdash; compare zones 1&ndash;${zoneCount}</summary>`);
  parts.push(`<div class="report-details-body">`);

  // Customer rates by zone
  parts.push(`<h4>Customer rates by zone (incl. road toll + ${vatPct}% VAT)</h4>`);
  const zoneHeaders = zonesForTable.map(z => `<th>Zone ${z} (${zoneLabels[z] || z})</th>`).join('');

  const bracketRows = shopifyBrackets.map(bracket => {
    const svcId = bracket.serviceId || primaryService;
    const cells = zonesForTable.map(zone => {
      const rate = rateLookup.byServiceZoneWeight(svcId, zone, Number(bracket.rateWeight));
      const price = rate ? domesticCustomerPrice(rate.priceNok, avgRoadToll, vatMultiplier) : null;
      return `<td>${price != null ? price + ' kr' : 'N/A'}</td>`;
    }).join('');
    return `<tr><td>${esc(bracket.name)}</td>${cells}</tr>`;
  }).join('');

  parts.push(`<table><thead><tr><th>Weight bracket</th>${zoneHeaders}</tr></thead><tbody>${bracketRows}</tbody></table>`);

  // Full zone pricing per service
  const zoneNumbers = Array.from({ length: zoneCount }, (_, i) => i + 1);

  const serviceTables = usedServices.map(svcId => {
    const svcName = serviceNames[svcId] || svcId;
    const svcWeights = shopifyBrackets
      .filter(b => (b.serviceId || primaryService) === svcId)
      .map(b => b.rateWeight);

    const weightHeaders = svcWeights.map(w => `<th>${fmtWeight(w)}</th>`).join('');
    const zoneRows = zoneNumbers.map(zone => {
      const z = String(zone);
      const cells = svcWeights.map(w => {
        const rate = rateLookup.byServiceZoneWeight(svcId, z, Number(w));
        return `<td>${rate ? fmtNok(rate.priceNok) : 'N/A'}</td>`;
      }).join('');
      return `<tr><td>${zone}</td>${cells}</tr>`;
    }).join('');

    return `<h4>${esc(svcName)} (${esc(svcId)}) &mdash; ex VAT, ex road toll</h4><table><thead><tr><th>Zone</th>${weightHeaders}</tr></thead><tbody>${zoneRows}</tbody></table>`;
  }).join('');

  parts.push(serviceTables);

  const cheapestLabel = zoneLabels['1'] || '1';
  const costliestLabel = zoneLabels[String(zoneCount)] || String(zoneCount);
  parts.push(`<p class="report-note">Zone 1 (${esc(cheapestLabel)}) is cheapest. Zone ${zoneCount} (${esc(costliestLabel)}) costs roughly 2&times; Zone 1. The recommended rates above use Zone ${safeZone} as a safe middle ground.</p>`);
  parts.push(`</div></details>`);

  return parts.join('');
}

// ── International details ────────────────────────────────────────────────────

function renderInternationalDetails(model) {
  const { rateLookup, countryNames, cheapestIntl, serviceNames, analysis } = model;
  const intlWeightColumns = analysis.internationalWeightColumns;

  const parts = [];
  parts.push(`<details class="report-details">`);
  parts.push(`<summary>International rates per country &mdash; ${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)})</summary>`);
  parts.push(`<div class="report-details-body">`);

  const weightHeaders = intlWeightColumns.map(w => `<th>${fmtWeight(w)}</th>`).join('');
  parts.push(`<table><thead><tr><th>Country</th>${weightHeaders}</tr></thead><tbody>`);

  for (const [code, name] of Object.entries(countryNames)) {
    const cells = intlWeightColumns.map(w => {
      const rate = rateLookup.byCountryServiceWeight(code, cheapestIntl, Number(w));
      return `<td>${rate ? Math.ceil(rate.priceNok) : 'N/A'}</td>`;
    }).join('');
    parts.push(`<tr><td>${esc(name)}</td>${cells}</tr>`);
  }

  parts.push(`</tbody></table>`);
  parts.push(`<p class="report-note">Raw agreement prices in kr, no VAT. These are the actual rates from your Bring contract.</p>`);
  parts.push(`</div></details>`);

  return parts.join('');
}

// ── Profitability details ────────────────────────────────────────────────────

function renderProfitabilityDetails(model) {
  const { profitability: prof, safeZone } = model;

  const parts = [];
  parts.push(`<details class="report-details">`);
  parts.push(`<summary>Profitability analysis &mdash; ${prof.totalShipments} shipments</summary>`);
  parts.push(`<div class="report-details-body">`);

  parts.push(`<p>Based on ${prof.totalShipments} shipments from invoice data that matched a configured bracket, `);
  parts.push(`projected against the recommended customer rates (Zone ${esc(safeZone)} pricing). `);
  parts.push(`Brackets with 0 shipments have no historical data yet.</p>`);

  // Skipped explanation
  if (prof.skipped.total > 0) {
    const skipParts = [];
    if (prof.skipped.noWeight > 0) skipParts.push(`${prof.skipped.noWeight} missing weight data`);
    if (prof.skipped.noMatchingBracket > 0) skipParts.push(`${prof.skipped.noMatchingBracket} no matching bracket`);

    const reasons = Object.entries(prof.skipped.byReason).sort((a, b) => b[1] - a[1]);
    const breakdown = reasons.length > 0
      ? '<br>Breakdown: ' + reasons.map(([reason, count]) => `${reason} (${count})`).join(', ') + '.'
      : '';

    parts.push(`<p class="report-note"><strong>${prof.skipped.total} shipments excluded</strong> from this analysis: ${skipParts.join(', ')}.${breakdown}</p>`);
  }

  // Per-bracket summary table
  parts.push(`<h4>Per-bracket summary</h4>`);
  const bracketRows2 = prof.brackets.map(renderBracketRow).join('');
  parts.push(`<table><thead><tr><th>Bracket</th><th>Qty</th><th>Avg cost</th><th>Rate</th><th>Rev. ex VAT</th><th>Avg margin</th><th>Total margin</th></tr></thead><tbody>${bracketRows2}`);

  // Total row
  const totalCls = prof.grandTotalMargin >= 0 ? 'margin-positive' : 'margin-negative';
  const avgSign = prof.avgMarginAll >= 0 ? '+' : '';
  const totalSign = prof.grandTotalMargin >= 0 ? '+' : '';
  parts.push(`<tr class="total-row"><td><strong>Total</strong></td><td><strong>${prof.totalShipments}</strong></td><td></td><td></td><td></td>`);
  parts.push(`<td class="${totalCls}"><strong>${avgSign}${fmtNok(prof.avgMarginAll)}/parcel</strong></td>`);
  parts.push(`<td class="${totalCls}"><strong>${totalSign}${fmtNok(prof.grandTotalMargin)}</strong></td></tr>`);
  parts.push(`</tbody></table>`);
  parts.push(`<p class="report-note">Overall margin: ${prof.marginPct.toFixed(1)}% of revenue ex VAT.</p>`);

  // Worst case per bracket
  parts.push(`<h4>Worst-case shipment per bracket</h4>`);
  parts.push(`<p class="report-note">The most expensive shipment in each bracket &mdash; your floor for margin evaluation.</p>`);
  const worstRows = prof.brackets
    .filter(b => b.shipments.length > 0)
    .map(bracket => {
      const worst = bracket.shipments.reduce((costliest, current) => costliest.totalCost > current.totalCost ? costliest : current);
      const cls = worst.margin >= 0 ? 'margin-positive' : 'margin-negative';
      const sign = worst.margin >= 0 ? '+' : '';
      return `<tr><td>${esc(bracket.name)}</td><td>${esc(worst.toCity)}</td><td>${worst.weight} kg</td><td>${fmtNok(worst.totalCost)}</td><td>${fmtNok(bracket.revenueExVat)}</td><td class="${cls}">${sign}${fmtNok(worst.margin)}</td></tr>`;
    }).join('');
  parts.push(`<table><thead><tr><th>Bracket</th><th>City</th><th>Weight</th><th>Cost</th><th>Rev. ex VAT</th><th>Margin</th></tr></thead><tbody>${worstRows}</tbody></table>`);

  // Loss-making shipments
  if (prof.lossMaking.length > 0) {
    parts.push(renderLossMakingSection(prof, safeZone));
  } else {
    parts.push(`<p>All ${prof.totalShipments} shipments would be profitable at the recommended rates.</p>`);
  }

  parts.push(`</div></details>`);
  return parts.join('');
}

function valueOrNa(value, fmt = fmtNok) {
  return value != null ? fmt(value) : 'N/A';
}

function renderBracketRow(bracket) {
  const n = bracket.shipments.length;
  if (n === 0) {
    return `<tr><td>${esc(bracket.name)}</td><td>0</td><td>&mdash;</td><td>${valueOrNa(bracket.shopifyPrice, p => p + ' kr')}</td><td>${valueOrNa(bracket.revenueExVat)}</td><td>&mdash;</td><td>&mdash;</td></tr>`;
  }

  const marginCls = bracket.avgMargin >= 0 ? 'margin-positive' : 'margin-negative';
  const sign = bracket.avgMargin >= 0 ? '+' : '';
  const totalSign = bracket.totalMargin >= 0 ? '+' : '';

  return [
    `<tr>`,
    `<td>${esc(bracket.name)}</td>`,
    `<td>${n}</td>`,
    `<td>${fmtNok(bracket.avgCost)}</td>`,
    `<td>${bracket.shopifyPrice} kr</td>`,
    `<td>${fmtNok(bracket.revenueExVat)}</td>`,
    `<td class="${marginCls}">${sign}${fmtNok(bracket.avgMargin)}</td>`,
    `<td class="${marginCls}">${totalSign}${fmtNok(bracket.totalMargin)}</td>`,
    `</tr>`,
  ].join('');
}

function renderLossMakingSection(prof, safeZone) {
  const topN = 10;
  const showInline = prof.lossMaking.slice(0, topN);

  const parts = [];
  parts.push(`<h4>Loss-making shipments (${prof.lossMaking.length} of ${prof.totalShipments})</h4>`);
  parts.push(`<p class="report-note">Shipments where Zone ${esc(safeZone)} pricing doesn't fully cover costs. Showing worst ${Math.min(topN, prof.lossMaking.length)}:</p>`);
  parts.push(renderLossTable(showInline));

  if (prof.lossMaking.length > topN) {
    parts.push(`<details class="report-details-nested">`);
    parts.push(`<summary>Show all ${prof.lossMaking.length} loss-making shipments</summary>`);
    parts.push(`<div class="report-details-body">${renderLossTable(prof.lossMaking)}</div></details>`);
  }

  return parts.join('');
}

function renderLossTable(items) {
  const rows = items.map(s => [
    `<tr>`,
    `<td>${esc(s.bracket)}</td>`,
    `<td>${esc(s.toCity)}</td>`,
    `<td>${esc(s.toPostalCode)}</td>`,
    `<td>${s.weight} kg</td>`,
    `<td>${s.totalCost.toFixed(0)}</td>`,
    `<td>${s.revenueExVat.toFixed(0)}</td>`,
    `<td class="margin-negative">${s.margin.toFixed(0)}</td>`,
    `</tr>`,
  ].join('')).join('');

  return `<table><thead><tr><th>Bracket</th><th>City</th><th>Postal</th><th>Weight</th><th>Cost</th><th>Rev.</th><th>Loss</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ── Invoice summary ──────────────────────────────────────────────────────────

function renderInvoiceSummary(model) {
  const { sortedProducts } = model;

  const rows = sortedProducts.map(([product, stats]) => {
    const avgPrice = (stats.totalAgreement / stats.count).toFixed(2);
    const avgWeight = stats.weights.length > 0
      ? (stats.weights.reduce((a, b) => a + b, 0) / stats.weights.length).toFixed(2) + ' kg'
      : 'N/A';
    return `<tr><td>${esc(product)}</td><td>${stats.count}</td><td>${fmtNok(stats.totalAgreement)}</td><td>${avgPrice} kr</td><td>${avgWeight}</td></tr>`;
  }).join('');

  return [
    `<details class="report-details">`,
    `<summary>Invoice data &mdash; shipments by product</summary>`,
    `<div class="report-details-body">`,
    `<table><thead><tr><th>Product</th><th>Shipments</th><th>Total paid</th><th>Avg per shipment</th><th>Avg weight</th></tr></thead>`,
    `<tbody>${rows}</tbody></table>`,
    `</div></details>`,
  ].join('');
}

// ── Assumptions ──────────────────────────────────────────────────────────────

function renderAssumptions(model) {
  const { cheapestIntl, vatPct, avgRoadToll, safeZone, zoneCount, zoneLabels, serviceDescriptions, serviceNames, analysis } = model;

  const rows = [];

  if (serviceDescriptions.length > 1) {
    const descs = serviceDescriptions.map(s => `${s.name} (${s.id}): ${s.range}`);
    rows.push(`<tr><th>Domestic services</th><td>${descs.map(esc).join('<br>')}</td></tr>`);
  } else {
    const s = serviceDescriptions[0];
    rows.push(`<tr><th>Domestic service</th><td>${esc(s.name)} (${esc(s.id)})</td></tr>`);
  }

  const mergePct = Math.round((analysis.intlZoneMergeThreshold ?? 0.10) * 100);

  rows.push(`<tr><th>International service</th><td>${esc(serviceNames[cheapestIntl] || cheapestIntl)} (${esc(cheapestIntl)})</td></tr>`);
  rows.push(`<tr><th>VAT</th><td>${vatPct}% (Norway only, added to customer-facing rates)</td></tr>`);
  rows.push(`<tr><th>Road toll</th><td>~${avgRoadToll} kr per shipment (avg from invoices, Norway only)</td></tr>`);
  const cheapLabel = zoneLabels['1'] || '1';
  const costLabel = zoneLabels[String(zoneCount)] || String(zoneCount);
  rows.push(`<tr><th>Norway pricing zone</th><td>Zone ${esc(safeZone)} &mdash; covers most of the country. Zone 1 (${esc(cheapLabel)}) is cheapest, Zone ${zoneCount} (${esc(costLabel)}) ~2&times; Zone 1</td></tr>`);
  rows.push(`<tr><th>Price rounding</th><td>Rounded up to next "nice" price ending in 9</td></tr>`);
  rows.push(`<tr><th>International grouping</th><td>Countries with rates within ${mergePct}% of each other are merged into one zone. The zone charges the highest rate so you never lose money. Adjust <code>intlZoneMergeThreshold</code> in the account config to change.</td></tr>`);
  rows.push(`<tr><th>Zone caveat</th><td>Zone numbers can differ per service for the same postal code</td></tr>`);

  return [
    `<details class="report-details">`,
    `<summary>Assumptions &amp; methodology</summary>`,
    `<div class="report-details-body">`,
    `<table class="assumptions-table"><tbody>${rows.join('')}</tbody></table>`,
    `</div></details>`,
  ].join('');
}

// ── Timestamp ────────────────────────────────────────────────────────────────

function renderTimestamp(isoString) {
  const display = isoString.replace('T', ' ').replace(/\.\d+Z/, ' UTC');
  return `<p class="report-timestamp">Generated ${display}</p>`;
}

// ── Simulator data ───────────────────────────────────────────────────────────

function renderSimulatorData(model) {
  const { volume, profitability, vatMultiplier, shopifyBrackets, norwayRates } = model;

  if (!volume || !profitability) return '';

  const simData = {
    vatMultiplier,
    brackets: shopifyBrackets.map((b, i) => {
      const profBracket = profitability.brackets[i];
      const matchedVolume = profBracket?.shipments?.length ?? 0;
      return {
        name: b.name,
        baselinePrice: norwayRates[i].price,
        revenueExVat: profBracket?.revenueExVat ?? null,
        avgCost: profBracket?.avgCost ?? null,
        volume: matchedVolume,
      };
    }),
    domesticCounts: volume.domesticCounts,
  };

  return `<script type="application/json" id="sim-data">${JSON.stringify(simData)}<\/script>`;
}
