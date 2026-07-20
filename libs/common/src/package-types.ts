const BYTE_UNITS = {
  bytes: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
} as const;

const NOOP_UNITS = { count: 1 } as const;
const YEAR_UNITS = { year: 1 } as const;

export const PACKAGE_TYPE_CONFIG = {
  LIMIT: { allowedUnits: ['count'], supportedModes: ['add', 'set', 'usage_based'], unitFactors: NOOP_UNITS },
  SIZE: { allowedUnits: ['bytes', 'KB', 'MB', 'GB', 'TB'], supportedModes: ['add', 'set', 'usage_based'], unitFactors: BYTE_UNITS },
  TRAFFIC: { allowedUnits: ['bytes', 'KB', 'MB', 'GB', 'TB'], supportedModes: ['add', 'set'], unitFactors: BYTE_UNITS },
  YEAR: { allowedUnits: ['year'], supportedModes: ['add', 'set'], unitFactors: YEAR_UNITS },
} as const;

export type PackageType = keyof typeof PACKAGE_TYPE_CONFIG;
export type PackageMode = 'add' | 'set' | 'usage_based';

export function toBaseQuantity(type: PackageType, quantity: number, unit: string): number {
  const config = PACKAGE_TYPE_CONFIG[type];
  const factors = config.unitFactors as Record<string, number>;
  const factor = factors[unit];
  if (factor === undefined) {
    return quantity;
  }
  return quantity * factor;
}
