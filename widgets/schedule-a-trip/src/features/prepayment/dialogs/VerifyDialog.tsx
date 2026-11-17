import { Button, List, ListItem, ListItemText } from '@mui/material';
import { useEffect, useState } from 'react';
import type { BilledInvoice } from '../../../api/billing';
import { readBookingState, type BookingStateDoc } from '../../../storage/booking-state';
import type { BookingContext } from '../../extensions';
import { attachInvoice, searchClaimedInvoice, unlockClaim, type SearchOutcome } from '../charge';
import { actionErrorText, storageErrorText, type Text } from '../messages';
import { canUnlockClaim, chargeAcceptedSinceClaim } from '../rules';
import { usePrepaymentEnv } from '../use-prepayment-env';
import { DialogFrame, TextAlert } from './DialogFrame';

type Phase =
  | { readonly kind: 'searching' }
  | { readonly kind: 'result'; readonly doc: BookingStateDoc; readonly search: SearchOutcome }
  | { readonly kind: 'confirm-unlock'; readonly doc: BookingStateDoc }
  | { readonly kind: 'writing' }
  | { readonly kind: 'message'; readonly severity: 'success' | 'warning' | 'error'; readonly text: Text };

/**
 * The "prepayment to verify" dialog: the charge of the booking has an unknown outcome. It searches
 * the invoice at once (created since the claim, exact amount, same customer, product and notes);
 * a single match is attached, several are listed (a double charge to refund by hand), and only a
 * complete search with no match offers "No invoice found, unlock", confirmed, once the claim is
 * old enough. A failed search never unlocks.
 *
 * @param props - The row and how to close.
 * @returns The dialog.
 */
export function VerifyDialog({ ctx, onClose }: { readonly ctx: BookingContext; readonly onClose: () => void }) {
  const env = usePrepaymentEnv();
  const { i18n, deps, settings, formatAmount } = env;
  const bookingId = ctx.booking.id;
  const [phase, setPhase] = useState<Phase>({ kind: 'searching' });

  const unexpected: Phase = { kind: 'message', severity: 'error', text: { key: 'prepayment.error.unexpected' } };

  const attachPhase = async (invoice: BilledInvoice): Promise<Phase> => {
      if (!deps) return unexpected;
      const written = await attachInvoice(deps, bookingId, invoice);
      await env.refresh(bookingId, written.ok ? written.value : null);
      if (!written.ok) {
        const failed = { kind: 'attach-failed', failure: written.error };
        env.logOutcome('verify', bookingId, failed);
        return { kind: 'message', severity: 'error', text: storageErrorText(written.error) };
      }
      return { kind: 'message', severity: 'success', text: { key: 'prepayment.verify.attached', params: { invoiceId: invoice.id } } };
  };

  const attach = async (invoice: BilledInvoice) => {
    setPhase({ kind: 'writing' });
    const result = await env.guard('verify', bookingId, () => attachPhase(invoice));
    setPhase(result.ok ? result.value : unexpected);
  };

  const searchPhase = async (): Promise<Phase> => {
    if (!deps || !settings) return unexpected;
    const read = await readBookingState(deps.collection, bookingId);
    if (!read.ok) return { kind: 'message', severity: 'error', text: storageErrorText(read.error) };
    const doc = read.value;
    if (!doc?.value.chargeStartedAt || doc.value.invoiceId) {
      await env.refresh(bookingId, doc);
      return { kind: 'message', severity: 'success', text: { key: 'prepayment.verify.nothingToVerify' } };
    }
    const outcome = await searchClaimedInvoice(deps, {
      booking: ctx.booking,
      doc,
      productId: settings.prepaymentProductId,
    });
    const [single] = outcome.kind === 'found' ? outcome.invoices : [];
    if (outcome.kind === 'found' && outcome.invoices.length === 1 && single) return attachPhase(single);
    if (outcome.kind === 'failed' || outcome.kind === 'incomplete') env.logOutcome('verify', bookingId, outcome);
    return { kind: 'result', doc, search: outcome };
  };

  const search = async () => {
    setPhase({ kind: 'searching' });
    const result = await env.guard('verify', bookingId, searchPhase);
    setPhase(result.ok ? result.value : unexpected);
  };

  const unlock = async (searchedClaimAt: string) => {
    if (!deps) return;
    setPhase({ kind: 'writing' });
    const result = await env.guard('unlock', bookingId, () => unlockClaim(deps, bookingId, searchedClaimAt));
    await env.refresh(bookingId, result.ok && result.value.ok ? result.value.value : null);
    if (!result.ok) {
      setPhase(unexpected);
      return;
    }
    const released = result.value;
    setPhase(
      released.ok
        ? { kind: 'message', severity: 'success', text: { key: 'prepayment.verify.unlocked' } }
        : { kind: 'message', severity: 'error', text: storageErrorText(released.error) },
    );
  };

  const blocked = env.blocker !== null || deps === null;
  useEffect(() => {
    if (!blocked) void search();
    // Searches once when the dialog opens (and when the settings arrive), never in a loop.
  }, [blocked]);

  const title = i18n.t('prepayment.verify.title');
  if (env.blocker) {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity="error" text={env.blocker} i18n={i18n} />
      </DialogFrame>
    );
  }
  if (phase.kind === 'searching' || phase.kind === 'writing') {
    return (
      <DialogFrame title={title} onClose={onClose} busy i18n={i18n}>
        <TextAlert severity="info" text={{ key: 'prepayment.verify.searching' }} i18n={i18n} />
      </DialogFrame>
    );
  }
  if (phase.kind === 'message') {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n}>
        <TextAlert severity={phase.severity} text={phase.text} i18n={i18n} />
      </DialogFrame>
    );
  }
  if (phase.kind === 'confirm-unlock') {
    return (
      <DialogFrame
        title={title}
        onClose={onClose}
        i18n={i18n}
        actions={
          <Button
            variant="contained"
            color="warning"
            onClick={() => void unlock(phase.doc.value.chargeStartedAt ?? '')}
          >
            {i18n.t('prepayment.verify.unlockConfirm')}
          </Button>
        }
      >
        <TextAlert severity="warning" text={{ key: 'prepayment.verify.unlockWarning' }} i18n={i18n} />
      </DialogFrame>
    );
  }

  const { search: outcome, doc } = phase;
  const retry = (
    <Button onClick={() => void search()}>{i18n.t('prepayment.verify.searchAgain')}</Button>
  );
  if (outcome.kind === 'found') {
    return (
      <DialogFrame title={title} onClose={onClose} i18n={i18n} actions={retry}>
        <TextAlert severity="warning" text={{ key: 'prepayment.verify.several' }} i18n={i18n} />
        <List dense>
          {outcome.invoices.map((invoice) => (
            <ListItem
              key={invoice.id}
              secondaryAction={
                <Button size="small" onClick={() => void attach(invoice)}>
                  {i18n.t('prepayment.verify.attach')}
                </Button>
              }
            >
              <ListItemText
                primary={invoice.id}
                secondary={[
                  invoice.amount === null ? '' : formatAmount(invoice.amount),
                  invoice.billingDate ? i18n.formatDate(new Date(invoice.billingDate), 'Pp') : '',
                  invoice.status ?? '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      </DialogFrame>
    );
  }
  if (outcome.kind === 'none') {
    const claimedAt = doc.value.chargeStartedAt ?? '';
    const accepted = chargeAcceptedSinceClaim(doc.value);
    const canUnlock = !accepted && canUnlockClaim(claimedAt, new Date());
    return (
      <DialogFrame
        title={title}
        onClose={onClose}
        i18n={i18n}
        actions={
          <>
            {retry}
            <Button
              variant="contained"
              color="warning"
              disabled={!canUnlock}
              onClick={() => setPhase({ kind: 'confirm-unlock', doc })}
            >
              {i18n.t('prepayment.verify.unlock')}
            </Button>
          </>
        }
      >
        <TextAlert severity="info" text={{ key: 'prepayment.verify.none' }} i18n={i18n} />
        {accepted && <TextAlert severity="warning" text={{ key: 'prepayment.verify.accepted' }} i18n={i18n} />}
        {!accepted && !canUnlock && (
          <TextAlert severity="warning" text={{ key: 'prepayment.verify.tooRecent' }} i18n={i18n} />
        )}
      </DialogFrame>
    );
  }
  const failure: Text =
    outcome.kind === 'failed'
      ? actionErrorText('verify', outcome.error)
      : { key: outcome.kind === 'incomplete' ? 'prepayment.verify.incomplete' : 'prepayment.verify.noClaim' };
  return (
    <DialogFrame title={title} onClose={onClose} i18n={i18n} actions={retry}>
      <TextAlert severity="error" text={failure} i18n={i18n} />
      <TextAlert severity="info" text={{ key: 'prepayment.verify.notChecked' }} i18n={i18n} />
    </DialogFrame>
  );
}
