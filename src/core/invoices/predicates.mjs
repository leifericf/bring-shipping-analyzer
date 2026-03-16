// Pure predicates for invoice line item classification.
// All predicates expect camelCase domain records.

/**
 * Whether a line item is a road toll charge.
 */
export const isRoadTollLine = (item) =>
  (item.description || '').includes('Road toll');

/**
 * Whether a line item is a surcharge.
 */
export const isSurchargeLine = (item) =>
  (item.description || '').includes('Surcharge');

/**
 * Whether a line item represents an actual shipment
 * (not a road toll or surcharge).
 */
export const isShipmentLine = (item) =>
  !isRoadTollLine(item) && !isSurchargeLine(item);
