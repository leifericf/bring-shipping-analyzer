// Pure functions for building a rate fetch plan.
// Turns config into a flat list of requests using flatMap/filter.

import { isDomesticDestination, isWeightWithinServiceLimit } from './predicates.mjs';

/**
 * @typedef {object} RateRequest
 * @property {object} destination
 * @property {object} service
 * @property {number} weightG
 */

/**
 * Build a flat list of (destination, service, weight) tuples to fetch.
 * Filters out weights that exceed each service's maxWeight.
 *
 * @param {object} config - Parsed config object
 * @returns {RateRequest[]}
 */
export function buildRateFetchPlan(config) {
  const isDomestic = isDomesticDestination(config.originCountry);

  return config.destinations.flatMap(destination => {
    const services = isDomestic(destination)
      ? config.domesticServices
      : config.internationalServices;

    return services.flatMap(service =>
      config.weightTiersGrams
        .filter(isWeightWithinServiceLimit(service))
        .map(weightG => ({ destination, service, weightG }))
    );
  });
}

/**
 * Build the Bring API request body for a single rate request.
 * Pure: requires the caller to supply the current date.
 *
 * @param {RateRequest} request
 * @param {object} ctx - Runtime context
 * @param {string} ctx.originCountry
 * @param {string} ctx.originPostalCode
 * @param {string} ctx.customerNumber
 * @param {{year: string, month: string, day: string}} ctx.shippingDate
 * @returns {object} - JSON body for the Bring Shipping Guide API
 */
export function toBringRequestBody(request, ctx) {
  return {
    consignments: [{
      id: '1',
      fromCountryCode: ctx.originCountry,
      fromPostalCode: ctx.originPostalCode,
      toCountryCode: request.destination.code,
      toPostalCode: request.destination.postalCode,
      shippingDate: ctx.shippingDate,
      products: [{ id: request.service.id, customerNumber: ctx.customerNumber }],
      packages: [{ id: '1', grossWeight: request.weightG }],
    }],
    withPrice: true,
    withExpectedDelivery: false,
    withGuiInformation: true,
  };
}
