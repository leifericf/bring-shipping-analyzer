// Pure international zone clustering by rate similarity.

import { intlCustomerPrice } from '../formatting.mjs';

/**
 * Compute nicePrice vector for a country at the given brackets.
 * Returns null prices for missing rate data.
 *
 * @param {string} countryCode
 * @param {object[]} brackets - e.g. internationalShopifyBrackets
 * @param {string} serviceId
 * @param {object} rateLookup
 * @returns {{ code: string, prices: (number|null)[] }}
 */
function countryPriceVector(countryCode, brackets, serviceId, rateLookup) {
  const prices = brackets.map(b => {
    const r = rateLookup.byCountryServiceWeight(countryCode, serviceId, Number(b.weight));
    return r ? intlCustomerPrice(r.priceNok) : null;
  });
  return { code: countryCode, prices };
}

/**
 * Whether two price vectors are within the merge threshold.
 *
 * @param {(number|null)[]} existingMin
 * @param {(number|null)[]} existingMax
 * @param {(number|null)[]} candidate
 * @param {number} threshold - Fraction (e.g. 0.10 for 10%)
 * @returns {boolean}
 */
function canMergeIntoZone(existingMin, existingMax, candidate, threshold) {
  return candidate.every((cp, i) => {
    if (cp === null) return true;
    const lo = Math.min(existingMin[i] ?? cp, cp);
    const hi = Math.max(existingMax[i] ?? cp, cp);
    // Guard: if all prices are 0, they are trivially within any threshold
    if (lo === 0) return true;
    return (hi - lo) / lo <= threshold;
  });
}

/**
 * Return a new zone with a country merged in, updating min/max bounds.
 */
function mergeIntoZone(zone, country) {
  return {
    codes: [...zone.codes, country.code],
    minPrices: zone.minPrices.map((min, i) =>
      country.prices[i] !== null ? Math.min(min ?? country.prices[i], country.prices[i]) : min
    ),
    maxPrices: zone.maxPrices.map((max, i) =>
      country.prices[i] !== null ? Math.max(max ?? country.prices[i], country.prices[i]) : max
    ),
  };
}

/**
 * Sort price vectors cheapest-first by comparing element-wise.
 */
function comparePriceVectors(a, b) {
  for (let i = 0; i < a.prices.length; i++) {
    const diff = (a.prices[i] ?? 0) - (b.prices[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Auto-group international countries into shipping zones based on rate similarity.
 * Countries whose nicePrice per bracket is within `threshold` of each other
 * are merged; the zone charges the highest price.
 *
 * @param {object} rateLookup
 * @param {string[]} countryCodes
 * @param {object[]} intlShopifyBrackets
 * @param {string} serviceId
 * @param {number} [threshold=0.10]
 * @returns {{ codes: string[], rates: { name: string, price: number|null }[] }[]}
 */
export function clusterInternationalZones(rateLookup, countryCodes, intlShopifyBrackets, serviceId, threshold = 0.10) {
  const hasAnyRate = (v) => v.prices.some(p => p !== null);

  const sortedVectors = countryCodes
    .map(code => countryPriceVector(code, intlShopifyBrackets, serviceId, rateLookup))
    .filter(hasAnyRate)
    .sort(comparePriceVectors);

  // Greedy merge: walk sorted countries, merge into current zone if within threshold
  const zones = sortedVectors.reduce((acc, country) => {
    const last = acc.length > 0 ? acc[acc.length - 1] : null;

    if (last && canMergeIntoZone(last.minPrices, last.maxPrices, country.prices, threshold)) {
      // Replace last zone with merged version
      return [...acc.slice(0, -1), mergeIntoZone(last, country)];
    }

    return [...acc, {
      codes: [country.code],
      minPrices: [...country.prices],
      maxPrices: [...country.prices],
    }];
  }, []);

  // Output: customer price = max price per bracket (conservative)
  return zones.map(z => ({
    codes: z.codes,
    rates: intlShopifyBrackets.map((b, i) => ({
      name: b.name,
      price: z.maxPrices[i],
    })),
  }));
}
