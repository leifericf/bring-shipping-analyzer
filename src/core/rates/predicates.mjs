// Pure predicates for rate fetching and classification.

/**
 * Whether a weight (grams) is within a service's max weight limit.
 */
export const isWeightWithinServiceLimit = (service) => (weightG) =>
  weightG <= service.maxWeight;

/**
 * Whether a destination is domestic (same country as origin).
 */
export const isDomesticDestination = (originCountry) => (destination) =>
  destination.code === originCountry;

/**
 * Whether a RateOutcome represents a successful price fetch.
 */
export const isSuccessfulOutcome = (outcome) =>
  outcome?.kind === 'ok';

/**
 * Whether a RateOutcome represents an API-level error.
 */
export const isErrorOutcome = (outcome) =>
  outcome?.kind === 'error';
