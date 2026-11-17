import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  OUT_OF_RANGE_LIMIT,
  vehiclesInRange,
  type CandidateVehicle,
} from './vehicles-in-range';

const center = { latitude: 0, longitude: 0 };
/** About 111.2 m per 0.001 degree of latitude. */
const north = (meters: number) => ({ latitude: meters / 111_195.08, longitude: 0 });

const vehicle = (id: string, overrides: Partial<CandidateVehicle> = {}): CandidateVehicle => ({
  id,
  status: 'AVAILABLE',
  serviceId: 'service-1',
  modelId: 7,
  location: north(100),
  ...overrides,
});

const search = { serviceId: 'service-1', modelId: 7, center, radiusMeters: 500 } as const;

describe('haversineMeters', () => {
  it('gives 0 between a point and itself', () => {
    expect(haversineMeters(center, center)).toBe(0);
  });

  it('gives the great-circle distance', () => {
    expect(haversineMeters(center, { latitude: 1, longitude: 0 })).toBeCloseTo(111_195.08, 0);
    expect(
      haversineMeters({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 }),
    ).toBeCloseTo(2 * 111_195.08, 0);
  });
});

describe('vehiclesInRange', () => {
  it('keeps the available, located vehicles of the service and model, closest first', () => {
    const result = vehiclesInRange(
      [
        vehicle('far', { location: north(400) }),
        vehicle('near', { location: north(50) }),
        vehicle('booked', { status: 'BOOKED' }),
        vehicle('unlocated', { location: null }),
        vehicle('other-service', { serviceId: 'service-2' }),
        vehicle('other-model', { modelId: 8 }),
        vehicle('no-status', { status: null }),
      ],
      search,
    );

    expect(result.inRange.map((v) => v.id)).toEqual(['near', 'far']);
    expect(result.inRange[0]?.distanceMeters).toBeCloseTo(50, 3);
    expect(result.closestOutOfRange).toEqual([]);
  });

  it('accepts any model with "any"', () => {
    const result = vehiclesInRange(
      [vehicle('a', { modelId: 8 }), vehicle('b', { modelId: null })],
      {
        ...search,
        modelId: 'any',
      },
    );
    expect(result.inRange.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('counts a vehicle exactly on the radius as in range', () => {
    const onEdge = vehicle('edge', { location: north(500) });
    const distance = haversineMeters(center, north(500));
    const result = vehiclesInRange([onEdge], { ...search, radiusMeters: distance });
    expect(result.inRange.map((v) => v.id)).toEqual(['edge']);
  });

  it('proposes the 10 closest vehicles out of range, closest first', () => {
    const outside = Array.from({ length: 12 }, (_, index) =>
      vehicle(`out-${index}`, { location: north(1000 + (12 - index) * 100) }),
    );
    const result = vehiclesInRange([vehicle('in'), ...outside], search);

    expect(result.inRange.map((v) => v.id)).toEqual(['in']);
    expect(result.closestOutOfRange).toHaveLength(OUT_OF_RANGE_LIMIT);
    expect(result.closestOutOfRange[0]?.id).toBe('out-11');
    expect(result.closestOutOfRange.at(-1)?.id).toBe('out-2');
  });

  it('gives nothing for no vehicle', () => {
    expect(vehiclesInRange([], search)).toEqual({ inRange: [], closestOutOfRange: [] });
  });

  it('keeps the fields of the vehicles and does not change them', () => {
    const input = [{ ...vehicle('a'), plate: 'AB-123-CD' }];
    const result = vehiclesInRange(input, search);
    expect(result.inRange[0]?.plate).toBe('AB-123-CD');
    expect(input[0]).not.toHaveProperty('distanceMeters');
  });
});
