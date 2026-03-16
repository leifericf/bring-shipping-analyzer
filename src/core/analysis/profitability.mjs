// Pure profitability computation.
// Takes pre-built data, returns a complete profitability model.

import { domesticCustomerPrice } from '../formatting.mjs';
import { isLossMaking, matchesBracket } from './predicates.mjs';

/**
 * @typedef {object} ProfitabilityModel
 * @property {object[]} brackets
 * @property {number} totalShipments
 * @property {number} grandTotalMargin
 * @property {number} grandTotalCost
 * @property {number} grandTotalRevenue
 * @property {number} avgMarginAll
 * @property {number} marginPct
 * @property {object[]} lossMaking
 * @property {object} skipped
 */

/**
 * Build bracket definitions with pricing from rate lookup.
 */
function buildPricedBrackets(shopifyBrackets, primaryService, rateLookup, safeZone, roadToll, vatMultiplier) {
  return shopifyBrackets.map(b => {
    const serviceId = b.serviceId || primaryService;
    const rate = rateLookup.byServiceZoneWeight(serviceId, safeZone, Number(b.rateWeight));
    const shopifyPrice = rate ? domesticCustomerPrice(rate.priceNok, roadToll, vatMultiplier) : null;
    const revenueExVat = shopifyPrice != null ? shopifyPrice / vatMultiplier : null;

    return {
      name: b.name,
      maxWeight: b.maxWeight ?? Infinity,
      rateWeight: b.rateWeight,
      serviceId,
      shopifyPrice,
      revenueExVat,
      shipments: [],
    };
  });
}

/**
 * Classify a shipment into the skip-reason breakdown.
 */
function classifySkipReason(shipment, brackets) {
  const configuredIds = new Set(brackets.map(b => b.serviceId));

  if (!configuredIds.has(shipment.productCode)) {
    return `Service ${shipment.productCode} not in configured brackets`;
  }

  const serviceBrackets = brackets.filter(b => b.serviceId === shipment.productCode);
  const maxWeight = Math.max(...serviceBrackets.map(b => b.maxWeight));

  if (shipment.weight > maxWeight) {
    return `Weight ${shipment.weight} kg exceeds max bracket`;
  }

  return `Service ${shipment.productCode}, ${shipment.weight} kg \u2014 no bracket match`;
}

/**
 * Assign shipments to brackets without mutating. Returns new brackets
 * with shipments populated, plus skip stats.
 */
function assignShipmentsToBrackets(shipments, brackets) {
  // Build a map of bracket index -> matched shipment records
  const matched = brackets.map(() => []);
  const skipped = { noWeight: 0, noMatchingBracket: 0, total: 0, byReason: {} };

  for (const [, s] of shipments) {
    if (s.weight === null) {
      skipped.noWeight++;
      skipped.total++;
      continue;
    }

    const bracketIdx = brackets.findIndex(b => matchesBracket(b)(s));

    if (bracketIdx !== -1) {
      const bracket = brackets[bracketIdx];
      matched[bracketIdx].push({
        weight: s.weight,
        totalCost: s.totalCost,
        toCity: s.toCity,
        toPostalCode: s.toPostalCode,
        revenueExVat: bracket.revenueExVat,
        margin: bracket.revenueExVat - s.totalCost,
      });
    } else {
      skipped.noMatchingBracket++;
      skipped.total++;
      const reason = classifySkipReason(s, brackets);
      skipped.byReason[reason] = (skipped.byReason[reason] || 0) + 1;
    }
  }

  const populatedBrackets = brackets.map((b, i) => ({ ...b, shipments: matched[i] }));
  return { brackets: populatedBrackets, skipped };
}

/**
 * Compute per-bracket aggregates (totals, averages).
 */
function computeBracketAggregates(brackets) {
  return brackets.map(bracket => {
    const n = bracket.shipments.length;
    if (n === 0) return bracket;

    const totalCost = bracket.shipments.reduce((sum, s) => sum + s.totalCost, 0);
    const totalMargin = bracket.shipments.reduce((sum, s) => sum + s.margin, 0);

    return {
      ...bracket,
      totalCost,
      avgCost: totalCost / n,
      totalMargin,
      avgMargin: totalMargin / n,
    };
  });
}

/**
 * Compute the complete profitability model.
 *
 * @param {Map} shipments - Map of shipment profiles
 * @param {object} rateLookup - From buildRateLookup
 * @param {object} analysisConfig - The analysis section of config
 * @param {number} roadToll - Average road toll
 * @returns {ProfitabilityModel}
 */
export function computeProfitability(shipments, rateLookup, analysisConfig, roadToll) {
  const { primaryDomesticService, safeDefaultZone, vatMultiplier, domesticShopifyBrackets } = analysisConfig;

  const pricedBrackets = buildPricedBrackets(
    domesticShopifyBrackets, primaryDomesticService,
    rateLookup, safeDefaultZone, roadToll, vatMultiplier,
  );

  const { brackets: populatedBrackets, skipped } = assignShipmentsToBrackets(shipments, pricedBrackets);
  const aggregated = computeBracketAggregates(populatedBrackets);

  const totalShipments = aggregated.reduce((sum, b) => sum + b.shipments.length, 0);
  const grandTotalMargin = aggregated.reduce((sum, b) => sum + (b.totalMargin || 0), 0);
  const grandTotalCost = aggregated.reduce((sum, b) => sum + (b.totalCost || 0), 0);
  const grandTotalRevenue = aggregated
    .filter(b => b.shipments.length > 0)
    .reduce((sum, b) => sum + b.revenueExVat * b.shipments.length, 0);

  const avgMarginAll = totalShipments > 0 ? grandTotalMargin / totalShipments : 0;
  const marginPct = grandTotalRevenue > 0 ? (grandTotalMargin / grandTotalRevenue) * 100 : 0;

  const lossMaking = aggregated
    .flatMap(bracket =>
      bracket.shipments
        .filter(isLossMaking)
        .map(s => ({ ...s, bracket: bracket.name }))
    )
    .sort((a, b) => a.margin - b.margin);

  return {
    brackets: aggregated,
    totalShipments,
    grandTotalMargin,
    grandTotalCost,
    grandTotalRevenue,
    avgMarginAll,
    marginPct,
    lossMaking,
    skipped,
  };
}
