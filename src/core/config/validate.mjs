// Pure config validation and normalization.
// Returns { ok: true, value } or { ok: false, errors: string[] }.
// No process.exit, no fs, no console.

/**
 * Validate and normalize a raw parsed config object.
 *
 * @param {object} raw - Parsed JSON from config file
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateConfig(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Config must be a JSON object'] };
  }

  // Required top-level fields
  const required = ['originCountry', 'destinations', 'weightTiersGrams', 'domesticServices', 'internationalServices', 'analysis'];
  const missing = required.filter(k => !(k in raw));
  if (missing.length > 0) {
    errors.push(`Missing required fields: ${missing.join(', ')}`);
  }

  // Destinations
  if (!Array.isArray(raw.destinations) || raw.destinations.length === 0) {
    errors.push('"destinations" must be a non-empty array');
  } else {
    raw.destinations.forEach((dest, i) => {
      if (!dest.country || !dest.code || !dest.postalCode) {
        errors.push(`destinations[${i}] needs country, code, and postalCode. Got: ${JSON.stringify(dest)}`);
      }
    });
  }

  // Weight tiers
  if (!Array.isArray(raw.weightTiersGrams) || raw.weightTiersGrams.length === 0) {
    errors.push('"weightTiersGrams" must be a non-empty array of numbers');
  }

  // Services
  for (const key of ['domesticServices', 'internationalServices']) {
    if (!Array.isArray(raw[key]) || raw[key].length === 0) {
      errors.push(`"${key}" must be a non-empty array`);
    } else {
      raw[key].forEach((svc, i) => {
        if (!svc.id || !svc.name || !svc.maxWeight) {
          errors.push(`${key}[${i}] needs id, name, and maxWeight. Got: ${JSON.stringify(svc)}`);
        }
      });
    }
  }

  // Analysis section
  if (!raw.analysis) {
    errors.push('"analysis" section is required');
  } else {
    const analysisRequired = ['vatMultiplier', 'safeDefaultZone', 'primaryDomesticService', 'cheapestInternationalService'];
    const analysisMissing = analysisRequired.filter(k => !(k in raw.analysis));
    if (analysisMissing.length > 0) {
      errors.push(`"analysis" missing fields: ${analysisMissing.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Build derived helpers
  const countryNames = raw.destinations
    .filter(dest => dest.code !== raw.originCountry)
    .reduce((acc, dest) => {
      acc[dest.code] = dest.country;
      return acc;
    }, {});

  return { ok: true, value: { ...raw, countryNames } };
}
