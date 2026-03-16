// Pure analysis model builder.
// Combines rates, invoice data, and config into a single AnalysisModel
// that renderers consume. No I/O, no DB, no logging.

import { domesticCustomerPrice, intlCustomerPrice } from '../formatting.mjs';
import { isRoadTollLine, isShipmentLine } from '../invoices/predicates.mjs';
import { isDomesticShipment } from './predicates.mjs';
import { buildRateLookup } from '../rates/aggregate.mjs';
import { clusterInternationalZones } from './cluster.mjs';
import { computeProfitability } from './profitability.mjs';

// ── Invoice analysis ─────────────────────────────────────────────────────────

/**
 * Analyze invoice line items into per-product stats and average road toll.
 * Uses predicates to classify lines.
 *
 * @param {object[]} lineItems - camelCase invoice line items
 * @returns {{ byProduct: object, avgRoadToll: number }}
 */
export function analyzeInvoices(lineItems) {
  const roadTollPrices = lineItems
    .filter(isRoadTollLine)
    .map(item => item.agreementPrice || 0)
    .filter(price => price > 0);

  const avgRoadToll = roadTollPrices.length > 0
    ? roadTollPrices.reduce((a, b) => a + b, 0) / roadTollPrices.length
    : 0;

  const byProduct = lineItems
    .filter(isShipmentLine)
    .reduce((acc, item) => {
      const key = `${item.productCode} - ${item.product}`;
      if (!acc[key]) {
        acc[key] = { count: 0, totalAgreement: 0, weights: [] };
      }
      acc[key].count++;
      acc[key].totalAgreement += item.agreementPrice || 0;
      if (item.weightKg) {
        acc[key].weights.push(item.weightKg);
      }
      return acc;
    }, {});

  return { byProduct, avgRoadToll };
}

// ── Shipment profiles ────────────────────────────────────────────────────────

/**
 * Group invoice line items into per-shipment profiles.
 * Each shipment aggregates total cost and extracts weight from non-toll/surcharge lines.
 *
 * @param {object[]} lineItems - camelCase invoice line items
 * @returns {Map<string, object>}
 */
export function buildShipmentProfiles(lineItems) {
  return lineItems
    .filter(item => item.shipmentNumber)
    .reduce((shipments, item) => {
    const key = item.shipmentNumber;

    if (!shipments.has(key)) {
      shipments.set(key, {
        productCode: item.productCode,
        toPostalCode: item.toPostalCode,
        toCity: item.toCity,
        deliveryCountry: item.deliveryCountry || '',
        weight: null,
        totalCost: 0,
      });
    }

    const s = shipments.get(key);
    s.totalCost += item.agreementPrice || 0;

    if (isShipmentLine(item) && item.weightKg) {
      s.weight = item.weightKg;
    }

    return shipments;
  }, new Map());
}

// ── Shipment volume ──────────────────────────────────────────────────────────

/**
 * Find the bracket index for a given weight.
 */
function findBracketIndex(weight, brackets) {
  return brackets.findIndex(b => weight <= (b.maxWeight ?? Infinity));
}

/**
 * Find the zone index for a given country code.
 */
function findZoneIndex(countryCode, intlZones) {
  return intlZones.findIndex(z => z.codes.includes(countryCode));
}

/**
 * Count shipments per destination zone x weight bracket.
 *
 * @param {Map} shipments - Shipment profiles
 * @param {object[]} intlZones - Clustered international zones
 * @param {object} config - Full config
 * @returns {object} Volume model
 */
export function computeShipmentVolume(shipments, intlZones, config) {
  const originCountry = config.originCountry;
  const shopifyBrackets = config.analysis.domesticShopifyBrackets;
  const isDomestic = isDomesticShipment(originCountry);

  const initial = {
    domesticCounts: shopifyBrackets.map(() => 0),
    domesticTotal: 0,
    intlZoneCounts: intlZones.map(() => shopifyBrackets.map(() => 0)),
    intlZoneTotals: intlZones.map(() => 0),
  };

  return [...shipments.values()]
    .filter(s => s.weight !== null)
    .reduce((vol, s) => {
      const bracketIdx = findBracketIndex(s.weight, shopifyBrackets);
      if (bracketIdx === -1) return vol;

      if (isDomestic(s)) {
        vol.domesticCounts[bracketIdx]++;
        vol.domesticTotal++;
      } else {
        const zoneIdx = findZoneIndex(s.deliveryCountry, intlZones);
        if (zoneIdx !== -1) {
          vol.intlZoneCounts[zoneIdx][bracketIdx]++;
          vol.intlZoneTotals[zoneIdx]++;
        }
      }

      return vol;
    }, initial);
}

// ── Model sub-builders ───────────────────────────────────────────────────────

function buildServiceNames(config) {
  return [...config.domesticServices, ...config.internationalServices]
    .reduce((acc, svc) => { acc[svc.id] = svc.name; return acc; }, {});
}

function buildNorwayRates(shopifyBrackets, primaryService, rateLookup, safeZone, roadToll, vatMultiplier) {
  return shopifyBrackets.map(b => {
    const svcId = b.serviceId || primaryService;
    const rate = rateLookup.byServiceZoneWeight(svcId, safeZone, Number(b.rateWeight));
    if (!rate) return { name: b.name, price: null, serviceId: svcId };
    return {
      name: b.name,
      price: domesticCustomerPrice(rate.priceNok, roadToll, vatMultiplier),
      serviceId: svcId,
    };
  });
}

function buildIntlZonePrices(intlZones, shopifyBrackets, rateLookup, cheapestIntl) {
  return intlZones.map(zone =>
    shopifyBrackets.map(b => {
      const prices = zone.codes
        .map(code => {
          const r = rateLookup.byCountryServiceWeight(code, cheapestIntl, Number(b.rateWeight));
          return r ? intlCustomerPrice(r.priceNok) : null;
        })
        .filter(p => p !== null);
      return prices.length > 0 ? Math.max(...prices) : null;
    })
  );
}

function buildZoneLabels(destinations, originCountry) {
  return destinations
    .filter(d => d.code === originCountry && d.zone != null)
    .reduce((acc, d) => { acc[String(d.zone)] = d.desc; return acc; }, {});
}

function buildServiceDescriptions(usedServices, shopifyBrackets, primaryService, serviceNames) {
  return usedServices.map(id => {
    const brackets = shopifyBrackets.filter(b => (b.serviceId || primaryService) === id);
    const range = brackets.map(b => b.name).join(', ');
    return { id, name: serviceNames[id] || id, range };
  });
}

function sortProducts(byProduct) {
  return Object.entries(byProduct)
    .filter(([, stats]) => stats.count > 0)
    .sort((a, b) => b[1].count - a[1].count);
}

// ── Full model builder ───────────────────────────────────────────────────────

/**
 * Build the complete analysis model from raw data.
 * This is the main "functional core" entry point for the analysis stage.
 * Each step delegates to a focused sub-builder.
 *
 * @param {object} params
 * @param {object[]} params.rates - camelCase shipping rate records
 * @param {object[]} params.lineItems - camelCase invoice line items
 * @param {object} params.config - Validated config
 * @param {string} params.generatedAt - ISO timestamp (supplied by shell)
 * @returns {object} AnalysisModel consumed by renderers
 */
export function buildAnalysisModel({ rates, lineItems, config, generatedAt }) {
  const analysis = config.analysis;
  const primaryService = analysis.primaryDomesticService;
  const cheapestIntl = analysis.cheapestInternationalService;
  const vatMultiplier = analysis.vatMultiplier;
  const safeZone = analysis.safeDefaultZone;
  const shopifyBrackets = analysis.domesticShopifyBrackets;
  const intlShopifyBrackets = analysis.internationalShopifyBrackets;

  const serviceNames = buildServiceNames(config);
  const usedServices = [...new Set(shopifyBrackets.map(b => b.serviceId || primaryService))];
  const rateLookup = buildRateLookup(rates);

  // Invoice analysis (compute first — road toll feeds into domestic pricing)
  const invoiceAnalysis = analyzeInvoices(lineItems);
  const avgRoadToll = Math.round(invoiceAnalysis.avgRoadToll * 100) / 100;

  const norwayRates = buildNorwayRates(shopifyBrackets, primaryService, rateLookup, safeZone, avgRoadToll, vatMultiplier);

  const intlCodes = Object.keys(config.countryNames);
  const intlZones = clusterInternationalZones(
    rateLookup, intlCodes, intlShopifyBrackets, cheapestIntl,
    analysis.intlZoneMergeThreshold ?? 0.10,
  );
  const intlZoneDomesticPrices = buildIntlZonePrices(intlZones, shopifyBrackets, rateLookup, cheapestIntl);

  // Profitability and volume (only if we have invoice data)
  let profitability = null;
  let volume = null;
  if (lineItems.length > 0) {
    const shipments = buildShipmentProfiles(lineItems);
    profitability = computeProfitability(shipments, rateLookup, analysis, avgRoadToll);
    volume = computeShipmentVolume(shipments, intlZones, config);
  }

  return {
    config,
    analysis,
    countryNames: config.countryNames,
    serviceNames,
    usedServices,
    serviceDescriptions: buildServiceDescriptions(usedServices, shopifyBrackets, primaryService, serviceNames),
    zoneLabels: buildZoneLabels(config.destinations, config.originCountry),
    rateLookup,
    norwayRates,
    intlZones,
    intlZoneDomesticPrices,
    invoiceAnalysis,
    avgRoadToll,
    sortedProducts: sortProducts(invoiceAnalysis.byProduct),
    profitability,
    volume,
    primaryService,
    cheapestIntl,
    vatMultiplier,
    vatPct: Math.round((vatMultiplier - 1) * 100),
    safeZone,
    zoneCount: analysis.domesticZoneCount,
    shopifyBrackets,
    intlShopifyBrackets,
    generatedAt,
  };
}
