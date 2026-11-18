import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click } from '../../../test/dom';
import { fakeInvoice } from '../../../test/fake-aima';
import { VALID_SETTINGS } from '../../../test/fake-bo';
import { doc, renderWithBilling, row } from '../../../test/prepayment-fixtures';
import type { BookingState } from '../../../storage/booking-state';
import { VerifyDialog } from './VerifyDialog';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

const claimedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const claim = (minutesAgo = 1): Partial<BookingState> => ({ chargeStartedAt: claimedAt(minutesAgo), chargeStartedBy: 'user-1', chargeAmount: 50, entityId: 'entity-1' });

const open = async (stored: Partial<BookingState>, invoices = [] as ReturnType<typeof fakeInvoice>[], bo?: Record<string, unknown>) => {
  const rendered = await renderWithBilling(<VerifyDialog ctx={row({ state: doc(stored) })} onClose={() => undefined} />, {
    stored,
    aima: { invoices },
    bo,
  });
  unmount = rendered.view.unmount;
  return rendered;
};

describe('VerifyDialog', () => {
  it('attaches the single invoice found at once', async () => {
    const { stored } = await open(claim(), [fakeInvoice({ id: 'invoice-7', billingDate: new Date().toISOString() })]);
    await vi.waitFor(() => expect(bodyText()).toContain('The invoice invoice-7 is attached to the booking.'));
    expect(stored()?.value.invoiceId).toBe('invoice-7');
  });

  it('lists several invoices and attaches the one chosen', async () => {
    const { stored } = await open(claim(), [fakeInvoice({ id: 'a' }), fakeInvoice({ id: 'b' })]);
    await vi.waitFor(() => expect(bodyText()).toContain('Several invoices match'));
    const attach = [...document.body.querySelectorAll('button')].filter((candidate) => candidate.textContent === 'Attach');
    attach[1]?.click();
    await vi.waitFor(() => expect(stored()?.value.invoiceId).toBe('b'));
  });

  it('offers no unlock while the claim is recent', async () => {
    await open(claim(2));
    await vi.waitFor(() => expect(bodyText()).toContain('No matching invoice was found.'));
    expect(button('No invoice found, unlock')?.disabled).toBe(true);
    expect(bodyText()).toContain('less than 10 minutes ago');
  });

  it('unlocks an old claim after a confirmation', async () => {
    const { stored } = await open(claim(30));
    await vi.waitFor(() => expect(button('No invoice found, unlock')?.disabled).toBe(false));
    click('No invoice found, unlock');
    await vi.waitFor(() => expect(bodyText()).toContain('Unlock the prepayment?'));
    click('Unlock');
    await vi.waitFor(() => expect(bodyText()).toContain('The prepayment is unlocked.'));
    expect(stored()?.value.chargeStartedAt).toBeNull();
  });

  it('never unlocks when the search fails, and searches again on demand', async () => {
    const { aima } = await open(claim(30));
    // The first search ran already; make the next one fail.
    await vi.waitFor(() => expect(button('Search again')).toBeDefined());
    aima.failNext('invoices-list', { status: 403 });
    click('Search again');
    await vi.waitFor(() => expect(bodyText()).toContain('You are not allowed to read the invoices'));
    expect(bodyText()).toContain('the prepayment stays locked');
    expect(button('No invoice found, unlock')).toBeUndefined();
  });

  it('never offers the unlock after an incomplete search', async () => {
    const noise = Array.from({ length: 2000 }, (_, index) => fakeInvoice({ id: `noise-${index}`, productNotes: 'other' }));
    await open(claim(30), noise);
    await vi.waitFor(() => expect(bodyText()).toContain('Too many invoices to check them all.'));
    expect(button('No invoice found, unlock')).toBeUndefined();
  });

  it('never offers the unlock when the API accepted the invoice', async () => {
    const accepted = { ...claim(30), chargeAcceptedAt: claimedAt(29), events: [{ at: claimedAt(30), by: 'user-1', type: 'charge-started' }, { at: claimedAt(29), by: 'user-1', type: 'charge-accepted' }] };
    await open(accepted);
    await vi.waitFor(() => expect(bodyText()).toContain('it exists and the prepayment cannot be unlocked'));
    expect(button('No invoice found, unlock')?.disabled).toBe(true);
  });

  it('says there is nothing to verify once an invoice is known', async () => {
    await open({ ...claim(), invoiceId: 'invoice-1' });
    await vi.waitFor(() => expect(bodyText()).toContain('Nothing left to verify'));
  });

  it('shows the reason when the settings are invalid, without searching', async () => {
    const { aima } = await open(claim(30), [], { getSettings: async () => ({ ...VALID_SETTINGS, dayRate: -1 }) });
    await vi.waitFor(() => expect(bodyText()).toContain('the settings of the widget are incomplete (dayRate)'));
    expect(aima.calls).toEqual([]);
  });
});
