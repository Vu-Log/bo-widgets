import { useQuery } from '@tanstack/react-query';
import { useAuthFetch } from '@vulog/bo-widget-react';
import { useCallback, useMemo } from 'react';
import { vehicleCatalogQueryOptions } from '../query/queries';

/**
 * The plate of a vehicle by id, from the vehicle catalogue (reference data, persisted).
 *
 * @param fleetId - The fleet.
 * @returns A lookup: the plate, `null` for no vehicle, an unknown one or while the catalogue loads.
 */
export function usePlateIndex(fleetId: string): (vehicleId: string | null) => string | null {
  const authFetch = useAuthFetch();
  const catalog = useQuery(vehicleCatalogQueryOptions(authFetch, fleetId));
  const plates = useMemo(
    () => new Map((catalog.data ?? []).map((vehicle) => [vehicle.id, vehicle.plate])),
    [catalog.data],
  );
  return useCallback(
    (vehicleId: string | null) => (vehicleId === null ? null : (plates.get(vehicleId) ?? null)),
    [plates],
  );
}
