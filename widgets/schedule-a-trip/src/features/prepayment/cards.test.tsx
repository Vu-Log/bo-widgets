import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, click } from '../../test/dom';
import { createI18n } from '../../i18n';
import { booking, doc, NOW, renderWithBilling, row } from '../../test/prepayment-fixtures';
import { InternalNotesCard, JournalCard, newestFirst, PaymentCard } from './cards';
import { prepaymentDialogs } from './store';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  prepaymentDialogs.close();
  vi.restoreAllMocks();
});

const show = async (ui: React.ReactNode) => {
  const rendered = await renderWithBilling(ui);
  unmount = rendered.view.unmount;
  await vi.waitFor(() => expect(bodyText()).not.toBe(''));
};

describe('PaymentCard', () => {
  it('shows the amounts, the warnings accepted and the wallet', async () => {
    await show(
      <PaymentCard ctx={row({ state: doc({ chargeStartedAt: NOW.toISOString(), invoiceId: 'invoice-1', chargeAmount: 60, computedAmount: 50, amountWarnings: ['above-computed'], walletId: 'wallet-1' }) })} />,
    );
    await vi.waitFor(() => expect(bodyText()).toContain('€60.00'));
    expect(bodyText()).toContain('invoice-1');
    expect(bodyText()).toContain('Computed amount€50.00');
    expect(bodyText()).toContain('Above the computed amount');
    expect(bodyText()).toContain('wallet-1');
  });

  it('opens the regularization from the card', async () => {
    const ctx = row({ tab: 'cancelled', state: doc({ refundedAt: NOW.toISOString(), toRegularize: { missingAmount: 3, at: NOW.toISOString() }, regularizationPending: true }) });
    await show(<PaymentCard ctx={ctx} />);
    click('Mark as regularized');
    expect(prepaymentDialogs.getSnapshot()).toEqual({ action: 'regularize', ctx });
  });

  it('shows an explicit empty state, or archived data, never a spinner', async () => {
    await show(<PaymentCard ctx={row({ state: null })} />);
    expect(bodyText()).toContain('Nothing recorded for this booking.');
    unmount?.();
    await show(<PaymentCard ctx={row({ state: null, booking: booking({ startDate: '2024-01-01T00:00:00.000Z', plannedReturnDate: null }) })} />);
    expect(bodyText()).toContain('not kept beyond 365 days');
  });
});

describe('InternalNotesCard', () => {
  it('shows the notes and opens their edition', async () => {
    const ctx = row({ state: doc({ internalNotes: 'Child seat' }) });
    await show(<InternalNotesCard ctx={ctx} />);
    expect(bodyText()).toContain('Child seat');
    click('Internal notes');
    expect(prepaymentDialogs.getSnapshot()?.action).toBe('notes');
  });

  it('offers no edition of archived data', async () => {
    await show(<InternalNotesCard ctx={row({ state: null, booking: booking({ startDate: '2024-01-01T00:00:00.000Z', plannedReturnDate: null }) })} />);
    expect(document.body.querySelector('button')).toBeNull();
  });
});

describe('JournalCard', () => {
  it('lists the entries newest first, the scheduler named', async () => {
    await show(
      <JournalCard
        ctx={row({
          state: doc({
            events: [
              { at: '2026-03-10T08:00:00.000Z', by: 'user-1', type: 'charge-started' },
              { at: '2026-03-10T09:00:00.000Z', by: null, type: 'allocated' },
              { at: '2026-03-10T10:00:00.000Z', by: 'user-1', type: 'charged' },
            ],
          }),
        })}
      />,
    );
    const items = [...document.body.querySelectorAll('li')].map((item) => item.textContent);
    const at = (iso: string) => createI18n('en_GB').formatDate(new Date(iso), 'Pp');
    expect(items).toEqual([
      `${at('2026-03-10T10:00:00.000Z')}Prepayment charged · user-1`,
      `${at('2026-03-10T09:00:00.000Z')}allocated · Scheduler`,
      `${at('2026-03-10T08:00:00.000Z')}Prepayment started · user-1`,
    ]);
  });

  it('shows an empty state', async () => {
    await show(<JournalCard ctx={row({ state: null })} />);
    expect(bodyText()).toContain('Nothing recorded for this booking.');
  });
});

describe('newestFirst', () => {
  it('reverses without changing the journal', () => {
    const events = [{ at: 'a', by: null, type: 'x' }, { at: 'b', by: null, type: 'y' }];
    expect(newestFirst(events).map((event) => event.at)).toEqual(['b', 'a']);
    expect(events[0]?.at).toBe('a');
    expect(newestFirst(undefined)).toEqual([]);
  });
});
