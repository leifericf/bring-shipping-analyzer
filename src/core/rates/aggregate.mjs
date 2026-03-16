// Pure aggregation functions for rate data.
// All functions expect and return camelCase domain records.

/**
 * Derive unique zone records from a list of rate records.
 * Deduplicates by (countryCode, postalCode, serviceId).
 *
 * @param {object[]} rateRecords - Flat list of camelCase rate records
 * @returns {object[]} - Sorted unique zone records
 */
export function deriveZones(rateRecords) {
  const seen = new Set();

  return rateRecords
    .filter(r => {
      const key = `${r.countryCode}_${r.postalCode}_${r.serviceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => ({
      countryCode: r.countryCode,
      postalCode: r.postalCode,
      serviceId: r.serviceId,
      zone: r.zone,
    }))
    .sort((a, b) =>
      a.countryCode.localeCompare(b.countryCode) ||
      a.postalCode.localeCompare(b.postalCode)
    );
}

/**
 * Build an O(1) lookup map from a rates array.
 * Supports lookup by (countryCode, serviceId, weightG)
 * and by (serviceId, zone, weightG).
 *
 * @param {object[]} rates - Flat list of camelCase rate records
 * @returns {{ byCountryServiceWeight: Function, byServiceZoneWeight: Function }}
 */
export function buildRateLookup(rates) {
  const byCountry = new Map();
  const byZone = new Map();

  for (const r of rates) {
    byCountry.set(`${r.countryCode}|${r.serviceId}|${r.weightG}`, r);
    if (r.zone) byZone.set(`${r.serviceId}|${r.zone}|${r.weightG}`, r);
  }

  return {
    byCountryServiceWeight(countryCode, serviceId, weightG) {
      return byCountry.get(`${countryCode}|${serviceId}|${weightG}`);
    },
    byServiceZoneWeight(serviceId, zone, weightG) {
      return byZone.get(`${serviceId}|${zone}|${weightG}`);
    },
  };
}
