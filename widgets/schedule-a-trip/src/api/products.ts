import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { requestJson, segment, type ApiResult } from './http';

const productSchema = z.looseObject({ id: z.string().min(1), price: z.number() });

/** A product of the fleet, reduced to its price. */
export interface ProductPrice {
  readonly id: string;
  readonly price: number;
}

/**
 * Reads the price of a product. `GET user/fleets/{fleetId}/products/{productId}`. A business value:
 * never persisted.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param productId - The product.
 * @param signal - Aborts the call.
 * @returns Its id and price, or why the call failed.
 */
export async function getProductPrice(
  authFetch: AuthFetch,
  fleetId: string,
  productId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProductPrice>> {
  const result = await requestJson(
    authFetch,
    `user/fleets/${segment(fleetId)}/products/${segment(productId)}`,
    productSchema,
    { signal },
  );
  if (!result.ok) return result;
  return { ok: true, data: { id: result.data.body.id, price: result.data.body.price } };
}
