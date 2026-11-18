import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { requestJson, segment, type ApiResult } from './http';

const invoiceSchema = z.object({
  id: z.string().min(1),
  // The field of the Invoice schema is `invoicesStatus`, with an s.
  invoicesStatus: z.string(),
  amount: z.number(),
  currency: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  userId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  entityId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  productId: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  invoiceDate: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

/** An invoice, reduced to its status and amount. A payment status: never persisted. */
export interface Invoice {
  readonly id: string;
  /** `PENDING`, `PAID`, `REFUSED`, `ERROR`, `REFUNDED`… (`invoicesStatus` of the API). */
  readonly status: string;
  readonly amount: number;
  readonly currency: string | null;
  readonly userId: string | null;
  readonly entityId: string | null;
  readonly productId: string | null;
  readonly invoiceDate: string | null;
}

/**
 * Reads an invoice. `GET user/billing/fleets/{fleetId}/invoices/{invoiceId}`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceId - The invoice.
 * @param signal - Aborts the call.
 * @returns The invoice, or why the call failed (`not-found` for an unknown id).
 */
export async function getInvoice(
  authFetch: AuthFetch,
  fleetId: string,
  invoiceId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Invoice>> {
  const result = await requestJson(
    authFetch,
    `user/billing/fleets/${segment(fleetId)}/invoices/${segment(invoiceId)}`,
    invoiceSchema,
    { signal },
  );
  if (!result.ok) return result;
  const { invoicesStatus, ...rest } = result.data.body;
  return { ok: true, data: { ...rest, status: invoicesStatus } };
}
