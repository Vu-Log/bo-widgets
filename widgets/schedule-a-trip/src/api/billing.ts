import type { AuthFetch } from '@vulog/bo-widget-sdk';
import { z } from 'zod';
import { requestJson, requestStatus, requestText, segment, type ApiResult } from './http';

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
  refundInProgress: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
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
  /** A refund of the invoice is in progress (the refund is asynchronous). */
  readonly refundInProgress: boolean;
}

const toInvoice = ({ invoicesStatus, ...rest }: z.output<typeof invoiceSchema>): Invoice => ({
  ...rest,
  status: invoicesStatus,
});

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
  return { ok: true, data: toInvoice(result.data.body) };
}

/** Most distinct ids of a call to {@link listInvoicesByIds}. */
export const MAX_INVOICE_IDS = 100;

const listedIdSchema = z.looseObject({ id: z.string().min(1) });

/**
 * Reads invoices by id, in one call. `POST user/billing/fleets/{fleetId}/invoices/list` with the
 * ids as the body; the API answers the same invoices as the GET by id, in any order, and leaves out
 * the ids it does not know. The route may be missing on an environment (403): see
 * `createInvoiceLoader` for the fallback.
 *
 * Each invoice is read on its own: an invoice the widget cannot read is an `invalid-response` for
 * its id only. An answer that holds an invoice not asked for, one without an id, or the same id
 * twice, breaks the contract of the route: the whole call is an `invalid-response`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceIds - At most {@link MAX_INVOICE_IDS} distinct ids (duplicates are merged); none
 *   gives an empty map without a call.
 * @param signal - Aborts the call.
 * @returns The result of each id the API answered, keyed by id (an id it left out is absent), or
 *   why the call failed (`invalid-request` without a call beyond {@link MAX_INVOICE_IDS} ids).
 */
export async function listInvoicesByIds(
  authFetch: AuthFetch,
  fleetId: string,
  invoiceIds: readonly string[],
  signal?: AbortSignal,
): Promise<ApiResult<ReadonlyMap<string, ApiResult<Invoice>>>> {
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return { ok: true, data: new Map() };
  if (ids.length > MAX_INVOICE_IDS) {
    return {
      ok: false,
      error: { kind: 'invalid-request', message: `More than ${MAX_INVOICE_IDS} invoice ids` },
    };
  }
  const result = await requestJson(
    authFetch,
    `${billing(fleetId)}/invoices/list`,
    z.array(z.unknown()),
    jsonInit('POST', ids, signal),
  );
  if (!result.ok) return result;
  const wanted = new Set(ids);
  const byId = new Map<string, ApiResult<Invoice>>();
  for (const item of result.data.body) {
    const listed = listedIdSchema.safeParse(item);
    if (!listed.success || !wanted.has(listed.data.id) || byId.has(listed.data.id)) {
      return {
        ok: false,
        error: { kind: 'invalid-response', message: 'An invoice not asked for, twice, or without an id' },
      };
    }
    const parsed = invoiceSchema.safeParse(item);
    byId.set(
      listed.data.id,
      parsed.success
        ? { ok: true, data: toInvoice(parsed.data) }
        : { ok: false, error: { kind: 'invalid-response', message: parsed.error.message } },
    );
  }
  return { ok: true, data: byId };
}

const isPositiveAmount = (amount: number): boolean => Number.isFinite(amount) && amount > 0;

const invalidAmount = (amount: number) =>
  ({ ok: false, error: { kind: 'invalid-request', message: `Invalid amount: ${amount}` } }) as const;

const billing = (fleetId: string) => `user/billing/fleets/${segment(fleetId)}`;

const jsonInit = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});

/** What `POST .../invoices/product` bills: a product, to a user and an entity. */
export interface ChargeProductInput {
  readonly productId: string;
  readonly amount: number;
  readonly userId: string;
  readonly entityId: string;
  /** Id of the operator who charges (`getCurrentUser().id`). */
  readonly originId: string;
  readonly productNotes: string;
  /** Booking request the product is billed for. */
  readonly bookingRequestId?: string;
}

/** The invoice a charge created, as far as its answer tells. */
export interface ChargedInvoice {
  /** `null` when the answer did not give it: the invoice exists, but must be searched for. */
  readonly invoiceId: string | null;
  /** `invoicesStatus` or `billingStatus` of the answer, when given. */
  readonly status: string | null;
}

const chargedObjectSchema = z.looseObject({
  id: z.string().min(1).optional(),
  invoicesStatus: z.string().optional(),
  billingStatus: z.string().optional(),
});

/** A bare invoice id: letters, digits and dashes, with at least one digit (never `OK` or `Created`). */
const BARE_ID = /^(?=.*\d)[\w-]{8,128}$/;

/**
 * Reads the answer of a charge, which the reference gives as a `string` and some versions as an
 * invoice object. Never fails: an answer it cannot read gives a `null` id.
 *
 * @param body - The body of the 2xx answer, as text.
 * @returns The id and the status when they can be read.
 */
export function readChargedInvoice(body: string): ChargedInvoice {
  const text = body.trim();
  if (text === '') return { invoiceId: null, status: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { invoiceId: BARE_ID.test(text) ? text : null, status: null };
  }
  if (typeof json === 'string') {
    return { invoiceId: BARE_ID.test(json) ? json : null, status: null };
  }
  const parsed = chargedObjectSchema.safeParse(json);
  if (!parsed.success) return { invoiceId: null, status: null };
  return {
    invoiceId: parsed.data.id ?? null,
    status: parsed.data.invoicesStatus ?? parsed.data.billingStatus ?? null,
  };
}

/**
 * Bills a product outside of a trip: creates one invoice per call (the API does not deduplicate:
 * claim the charge first). `POST user/billing/fleets/{fleetId}/invoices/product`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param input - Product, amount, customer, entity, operator and notes.
 * @param signal - Aborts the call.
 * @returns The invoice created (its id may be unknown), or why the call failed (`invalid-request`
 *   without a call for an amount that is not a positive number). A 400/401/403/404/422 means that
 *   no invoice was created; a `network`, `aborted`, 5xx or `back-office` failure does not tell.
 */
export async function chargeProduct(
  authFetch: AuthFetch,
  fleetId: string,
  input: ChargeProductInput,
  signal?: AbortSignal,
): Promise<ApiResult<ChargedInvoice>> {
  if (!isPositiveAmount(input.amount)) return invalidAmount(input.amount);
  const { bookingRequestId, ...body } = input;
  const result = await requestText(
    authFetch,
    `${billing(fleetId)}/invoices/product`,
    jsonInit(
      'POST',
      bookingRequestId === undefined ? body : { ...body, additionalInfo: { bookingRequestId } },
      signal,
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: readChargedInvoice(result.data) };
}

/**
 * Tries the payment of an invoice again; only for `REFUSED` and `ERROR`, the API moves it to
 * `PENDING`. `POST user/billing/fleets/{fleetId}/invoices/{invoiceId}/retry-payment`. The answer
 * has no documented body: read the invoice again for its new status.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceId - The invoice.
 * @param signal - Aborts the call.
 * @returns `ok`, or why the call failed.
 */
export const retryPayment = (
  authFetch: AuthFetch,
  fleetId: string,
  invoiceId: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ readonly status: number }>> =>
  requestStatus(
    authFetch,
    `${billing(fleetId)}/invoices/${segment(invoiceId)}/retry-payment`,
    jsonInit('POST', {}, signal),
  );

const refundableSchema = z.object({
  refundableAmount: z.number(),
  currency: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  refundablePaymentReceipts: z
    .array(z.looseObject({ pspReference: z.string().nullish() }))
    .nullish()
    .transform((value) => value ?? []),
});

/** How much of an invoice can still be refunded. */
export interface RefundableAmount {
  readonly amount: number;
  readonly currency: string | null;
  /** psp references of the receipts that can be refunded, in the order of the API. */
  readonly pspReferences: readonly string[];
}

/**
 * The amount of an invoice that can still be refunded.
 * `GET user/billing/fleets/{fleetId}/invoices/{invoiceId}/refundableAmount`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceId - The invoice.
 * @param signal - Aborts the call.
 * @returns The amount and the receipts, or why the call failed.
 */
export async function getRefundableAmount(
  authFetch: AuthFetch,
  fleetId: string,
  invoiceId: string,
  signal?: AbortSignal,
): Promise<ApiResult<RefundableAmount>> {
  const result = await requestJson(
    authFetch,
    `${billing(fleetId)}/invoices/${segment(invoiceId)}/refundableAmount`,
    refundableSchema,
    { signal },
  );
  if (!result.ok) return result;
  const body = result.data.body;
  return {
    ok: true,
    data: {
      amount: body.refundableAmount,
      currency: body.currency,
      pspReferences: body.refundablePaymentReceipts.flatMap((receipt) =>
        receipt.pspReference ? [receipt.pspReference] : [],
      ),
    },
  };
}

/** A refund to ask for. */
export interface RefundInput {
  readonly amount: number;
  readonly note: string;
  /** The psp reference of the receipt to refund, when the API gave one. */
  readonly paymentIntentPspReference: string | null;
}

/**
 * Refunds an invoice. `POST user/billing/fleets/{fleetId}/invoices/{invoiceId}/refund`. The API
 * refuses more than the refundable amount, so a second call after a refund that went through fails.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param invoiceId - The invoice.
 * @param input - Amount, note and receipt.
 * @param signal - Aborts the call.
 * @returns `ok`, or why the call failed.
 */
export const refundInvoice = (
  authFetch: AuthFetch,
  fleetId: string,
  invoiceId: string,
  input: RefundInput,
  signal?: AbortSignal,
): Promise<ApiResult<{ readonly status: number }>> =>
  !isPositiveAmount(input.amount)
    ? Promise.resolve(invalidAmount(input.amount))
    : requestStatus(
    authFetch,
    `${billing(fleetId)}/invoices/${segment(invoiceId)}/refund`,
    jsonInit(
      'POST',
      {
        amount: input.amount,
        note: input.note,
        ...(input.paymentIntentPspReference === null
          ? {}
          : { paymentIntentPspReference: input.paymentIntentPspReference }),
      },
      signal,
    ),
  );

const walletSchema = z.looseObject({
  id: z.string().min(1),
  availableAmount: z
    .number()
    .nullish()
    .transform((value) => value ?? null),
});

/** A wallet of credits, reduced to its balance. */
export interface Wallet {
  readonly id: string;
  /** `null` when the API does not give it. */
  readonly availableAmount: number | null;
}

/**
 * The wallets of an entity. `GET user/billing/fleets/{fleetId}/wallet/entity/{entityId}`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param entityId - The entity.
 * @param signal - Aborts the call.
 * @returns The wallets, or why the call failed.
 */
export async function listEntityWallets(
  authFetch: AuthFetch,
  fleetId: string,
  entityId: string,
  signal?: AbortSignal,
): Promise<ApiResult<readonly Wallet[]>> {
  const result = await requestJson(
    authFetch,
    `${billing(fleetId)}/wallet/entity/${segment(entityId)}`,
    z.array(walletSchema),
    { signal },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.body.map((wallet) => ({
      id: wallet.id,
      availableAmount: wallet.availableAmount,
    })),
  };
}

/**
 * Sets the available amount of a wallet (`0` to revoke its credits). Setting the same amount twice
 * gives the same wallet. `PATCH user/billing/fleets/{fleetId}/wallets/{walletId}`, a JSON Patch of
 * one `replace` of `/availableAmount`, the value written with a point.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param walletId - The wallet.
 * @param amount - The new available amount, at least 0.
 * @param signal - Aborts the call.
 * @returns `ok`, or why the call failed.
 */
export function setWalletAvailableAmount(
  authFetch: AuthFetch,
  fleetId: string,
  walletId: string,
  amount: number,
  signal?: AbortSignal,
): Promise<ApiResult<{ readonly status: number }>> {
  if (!Number.isFinite(amount) || amount < 0) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'invalid-request', message: `Invalid amount: ${amount}` },
    });
  }
  return requestStatus(authFetch, `${billing(fleetId)}/wallets/${segment(walletId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([{ op: 'replace', path: '/availableAmount', value: String(amount) }]),
    signal,
  });
}

const nullish = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const billedInvoiceSchema = z.looseObject({
  totalWithTax: nullish(z.number()),
  invoice: z.looseObject({
    id: z.string().min(1),
    invoicesStatus: nullish(z.string()),
    userId: nullish(z.string()),
    entityId: nullish(z.string()),
    billingDate: nullish(z.string()),
  }),
  product: nullish(
    z.looseObject({
      productId: nullish(z.string()),
      productNotes: nullish(z.string()),
      totalWithTax: nullish(z.number()),
    }),
  ),
});

/** An invoice of the billed invoices list, reduced to what identifies a product invoice. */
export interface BilledInvoice {
  readonly id: string;
  readonly status: string | null;
  readonly userId: string | null;
  readonly entityId: string | null;
  readonly productId: string | null;
  readonly productNotes: string | null;
  /** Total with tax of the product line, else of the invoice. */
  readonly amount: number | null;
  readonly billingDate: string | null;
}

/** Most days of a range of {@link listBilledInvoices}: the API takes one month at most. */
export const MAX_INVOICE_RANGE_DAYS = 28;
/** Largest page of {@link listBilledInvoices}. */
export const MAX_INVOICE_PAGE_SIZE = 200;

/** What {@link listBilledInvoices} lists. */
export interface ListBilledInvoicesParams {
  /** ISO date, start of the creation range. */
  readonly startDate: string;
  /** ISO date, end of the creation range: at most {@link MAX_INVOICE_RANGE_DAYS} after the start. */
  readonly endDate: string;
  readonly minAmount?: number;
  readonly maxAmount?: number;
  /** From 0. */
  readonly page: number;
  readonly size: number;
}

/**
 * The billed invoices of a fleet created in a range. `GET user/billing/fleets/{fleetId}/invoices`
 * with `startDate`, `endDate`, `minAmount`, `maxAmount`, `page` and `size`.
 *
 * @param authFetch - `useAuthFetch()`.
 * @param fleetId - The fleet.
 * @param params - Range, amounts and page.
 * @param signal - Aborts the call.
 * @returns One page of invoices, or why the call failed.
 */
export async function listBilledInvoices(
  authFetch: AuthFetch,
  fleetId: string,
  params: ListBilledInvoicesParams,
  signal?: AbortSignal,
): Promise<ApiResult<readonly BilledInvoice[]>> {
  const start = Date.parse(params.startDate);
  const end = Date.parse(params.endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return { ok: false, error: { kind: 'invalid-request', message: 'Invalid date range' } };
  }
  if (end - start > MAX_INVOICE_RANGE_DAYS * 86_400_000) {
    return { ok: false, error: { kind: 'invalid-request', message: 'Date range too long' } };
  }
  if (
    !Number.isInteger(params.page) ||
    params.page < 0 ||
    !Number.isInteger(params.size) ||
    params.size < 1 ||
    params.size > MAX_INVOICE_PAGE_SIZE
  ) {
    return { ok: false, error: { kind: 'invalid-request', message: 'Invalid page' } };
  }
  const query = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    page: String(params.page),
    size: String(params.size),
  });
  if (params.minAmount !== undefined) query.set('minAmount', String(params.minAmount));
  if (params.maxAmount !== undefined) query.set('maxAmount', String(params.maxAmount));
  const result = await requestJson(
    authFetch,
    `${billing(fleetId)}/invoices?${query}`,
    z.array(billedInvoiceSchema),
    { signal },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.body.map((item) => ({
      id: item.invoice.id,
      status: item.invoice.invoicesStatus,
      userId: item.invoice.userId,
      entityId: item.invoice.entityId,
      productId: item.product?.productId ?? null,
      productNotes: item.product?.productNotes ?? null,
      amount: item.product?.totalWithTax ?? item.totalWithTax,
      billingDate: item.invoice.billingDate,
    })),
  };
}
