import { describe, expect, it } from 'vitest';
import { candidateVehicles } from './vehicle-candidates';
import { vehiclesInRange } from './vehicles-in-range';

const catalog = [
  {
    id: 'vehicle-1',
    name: 'Car 1',
    plate: 'AB-123-CD',
    modelId: 7,
    modelName: 'City car',
    serviceIds: ['service-1', 'service-2'],
  },
  { id: 'vehicle-2', name: null, plate: null, modelId: 8, modelName: 'Van', serviceIds: ['service-2'] },
];
const live = [
  {
    id: 'vehicle-1',
    plate: null,
    status: 'AVAILABLE',
    location: { latitude: 48.8566, longitude: 2.3522 },
    autonomy: 120,
    energyLevel: 80,
    km: 1000,
  },
  {
    id: 'vehicle-2',
    plate: null,
    status: 'AVAILABLE',
    location: { latitude: 48.8567, longitude: 2.3523 },
    autonomy: null,
    energyLevel: null,
    km: null,
  },
  { id: 'vehicle-3', plate: 'ZZ-999-ZZ', status: 'AVAILABLE', location: null, autonomy: null, energyLevel: null, km: null },
];

describe('candidateVehicles', () => {
  it('gives a vehicle the service of the search when it belongs to it', () => {
    const candidates = candidateVehicles(catalog, live, 'service-1');
    expect(candidates.map((vehicle) => vehicle.serviceId)).toEqual(['service-1', null, null]);
    expect(candidates[0]).toMatchObject({ modelId: 7, modelName: 'City car', plate: 'AB-123-CD', energyLevel: 80 });
  });

  it('keeps the live plate of a vehicle missing from the catalogue', () => {
    expect(candidateVehicles(catalog, live, 'service-1')[2]).toMatchObject({
      plate: 'ZZ-999-ZZ',
      modelId: null,
      serviceId: null,
    });
  });

  it('feeds vehiclesInRange with the vehicles of the service only', () => {
    const result = vehiclesInRange(candidateVehicles(catalog, live, 'service-2'), {
      serviceId: 'service-2',
      modelId: 'any',
      center: { latitude: 48.8566, longitude: 2.3522 },
      radiusMeters: 500,
    });
    expect(result.inRange.map((vehicle) => vehicle.id)).toEqual(['vehicle-1', 'vehicle-2']);
  });

  it('gives nothing without live vehicles', () => {
    expect(candidateVehicles(catalog, [], 'service-1')).toEqual([]);
  });
});
