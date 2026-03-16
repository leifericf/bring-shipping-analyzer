// Pure functions for normalizing Bring API responses and DB records.

/**
 * @typedef {object} RateOutcome
 * @property {'ok'|'skip'|'error'} kind
 * @property {object} request - The original RateRequest
 * @property {number} [priceNok] - Parsed price (kind === 'ok')
 * @property {string} [serviceName] - Display name (kind === 'ok')
 * @property {string|number} [zone] - Zone identifier (kind === 'ok')
 * @property {string} [reason] - Why skipped or errored (kind !== 'ok')
 */

/**
 * Parse the first product from a Bring Shipping Guide API response
 * into a normalized RateOutcome.
 *
 * @param {object} apiJson - Parsed JSON response body
 * @param {object} request - The RateRequest that produced this response
 * @returns {RateOutcome}
 */
export function parseBringProductResponse(apiJson, request) {
  const product = apiJson.consignments?.[0]?.products?.[0];

  if (!product) {
    return { kind: 'skip', request, reason: 'No product in response' };
  }

  if (product.errors?.length > 0) {
    return { kind: 'error', request, reason: product.errors[0].description };
  }

  const netPrice = product.price?.netPrice?.priceWithoutAdditionalServices?.amountWithoutVAT;
  const listPrice = product.price?.listPrice?.priceWithoutAdditionalServices?.amountWithoutVAT;
  const price = netPrice != null ? netPrice : listPrice;
  const displayName = product.guiInformation?.displayName || request.service.name;
  const zone = product.price?.zones?.totalZoneCount;

  if (price == null) {
    return { kind: 'skip', request, reason: 'No price in response' };
  }

  return {
    kind: 'ok',
    request,
    priceNok: parseFloat(price),
    serviceName: displayName,
    zone,
  };
}

/**
 * Convert a successful RateOutcome into a domain rate record (camelCase).
 *
 * @param {RateOutcome} outcome - Must have kind === 'ok'
 * @returns {object} - camelCase rate record
 */
export function outcomeToRateRecord(outcome) {
  const { destination, service, weightG } = outcome.request;
  return {
    country: destination.country,
    countryCode: destination.code,
    postalCode: destination.postalCode,
    zone: outcome.zone,
    serviceId: service.id,
    serviceName: outcome.serviceName,
    weightG,
    priceNok: outcome.priceNok,
  };
}

/**
 * Normalize a rate record loaded from the DB.
 * Ensures zone is a clean string and priceNok has a default.
 *
 * @param {object} r - Raw DB record (already camelCase via SQL aliases)
 * @returns {object} - Normalized rate record
 */
export function normalizeDbRate(r) {
  return {
    ...r,
    zone: r.zone != null ? String(r.zone).replace(/\.0$/, '') : '',
    priceNok: r.priceNok ?? 0,
  };
}
