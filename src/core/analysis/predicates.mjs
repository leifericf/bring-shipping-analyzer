// Pure predicates for analysis classification.

/**
 * Whether a shipment is domestic (matches origin country).
 */
export const isDomesticShipment = (originCountry) => (shipment) =>
  shipment.deliveryCountry === originCountry;

/**
 * Whether a shipment matches a given bracket (service + weight ceiling).
 */
export const matchesBracket = (bracket) => (shipment) =>
  shipment.productCode === bracket.serviceId && shipment.weight <= bracket.maxWeight;

/**
 * Whether a profitability entry is loss-making.
 */
export const isLossMaking = (entry) =>
  entry.margin < 0;
