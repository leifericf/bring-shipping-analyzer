// Pure CLI summary renderer.
// Input: AnalysisModel -> Output: plain text string.
// No I/O, no DB, no side effects.

import { fmtNok, fmtZoneLabel } from '../formatting.mjs';

/**
 * Render a compact CLI summary from an AnalysisModel.
 *
 * @param {object} model - AnalysisModel from buildAnalysisModel
 * @returns {string} Plain text summary
 */
export function renderCliSummary(model) {
  const {
    norwayRates, intlZones, countryNames,
    usedServices, serviceNames, cheapestIntl,
    safeZone, vatPct, profitability,
  } = model;

  const multiService = usedServices.length > 1;
  const lines = [];

  lines.push('\n=== Recommended Shipping Rates ===\n');
  lines.push('  Norway');

  norwayRates.forEach(r => {
    const svcLabel = multiService
      ? `  [${serviceNames[r.serviceId] || r.serviceId} (${r.serviceId})]`
      : '';
    lines.push(`    ${r.name.padEnd(12)} ${r.price != null ? r.price + ' kr' : 'N/A'}${svcLabel}`);
  });

  intlZones.forEach(zone => {
    const zoneNames = fmtZoneLabel(zone, countryNames);
    lines.push('');
    lines.push(`  ${zoneNames}`);
    zone.rates.forEach(r => {
      lines.push(`    ${r.name.padEnd(12)} ${r.price != null ? r.price + ' kr' : 'N/A'}`);
    });
  });

  lines.push('');
  lines.push(`  Norway: Zone ${safeZone} pricing, incl. road toll + ${vatPct}% VAT.`);

  if (multiService) {
    const svcDesc = usedServices.map(s => `${serviceNames[s] || s} (${s})`).join(', ');
    lines.push(`  Services: ${svcDesc}.`);
  }

  lines.push(`  International: ${cheapestIntl}, no VAT. Grouped by highest rate.`);

  if (profitability && profitability.totalShipments > 0) {
    const sign = profitability.avgMarginAll >= 0 ? '+' : '';
    lines.push('');
    lines.push(`  Profitability: ${profitability.totalShipments} shipments, avg margin ${sign}${fmtNok(profitability.avgMarginAll)}/parcel, ${profitability.lossMaking.length} loss-making.`);

    if (profitability.skipped.total > 0) {
      const parts = [];
      if (profitability.skipped.noWeight > 0) parts.push(` ${profitability.skipped.noWeight} missing weight,`);
      if (profitability.skipped.noMatchingBracket > 0) parts.push(` ${profitability.skipped.noMatchingBracket} no matching bracket,`);
      const detail = parts.join('').replace(/,$/, '');
      lines.push(`  (${profitability.skipped.total} shipments excluded from profitability analysis:${detail})`);
    }
  }

  lines.push('');
  lines.push('  Open the web UI for the full report with drill-down details.');
  lines.push('');

  return lines.join('\n');
}
