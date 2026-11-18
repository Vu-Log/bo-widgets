import { apiErrorText, type ApiError } from '../../api/http';
import type { MessageKey, MessageParams } from '../../i18n';
import type { ClaimFailure } from '../../storage/booking-state';
import type { SettingsResult } from '../../settings';
import type { PrepaymentActionId } from './rules';
import type { UnlockFailure } from './charge';
import type { WriteFailure } from './writes';

/** A message to translate: a key of the catalogues and its parameters. */
export interface Text {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

const NOT_ALLOWED: Readonly<Record<PrepaymentActionId, MessageKey>> = {
  charge: 'prepayment.notAllowed.charge',
  verify: 'prepayment.notAllowed.verify',
  retry: 'prepayment.notAllowed.retry',
  refund: 'prepayment.notAllowed.refund',
  'resume-refund': 'prepayment.notAllowed.refund',
  regularize: 'prepayment.notAllowed.storage',
  'undo-regularization': 'prepayment.notAllowed.storage',
  notes: 'prepayment.notAllowed.storage',
};

/**
 * The message of a failed API call of an action: a 403 names the action ("You are not allowed to
 * refund…"), any other failure is the common API message.
 *
 * @param action - The action that called the API.
 * @param error - The failure.
 * @returns The message to show.
 */
export function actionErrorText(action: PrepaymentActionId, error: ApiError): Text {
  if (error.kind === 'not-allowed') return { key: NOT_ALLOWED[action] };
  return apiErrorText(error);
}

/**
 * The message of a storage write that failed or was refused.
 *
 * @param failure - The failure of a write, a claim or an unlock.
 * @returns The message to show.
 */
export function storageErrorText(failure: WriteFailure | ClaimFailure | UnlockFailure): Text {
  switch (failure.kind) {
    case 'conflict':
    case 'refused':
      return { key: 'prepayment.storage.changed' };
    case 'invalid-input':
      return { key: 'prepayment.storage.tooLong' };
    case 'not-found':
      return { key: 'prepayment.storage.gone' };
    case 'rate-limited':
      return { key: 'prepayment.storage.rateLimited' };
    case 'forbidden':
      return { key: 'prepayment.notAllowed.storage' };
    case 'unknown-outcome':
      return { key: 'prepayment.storage.unknownOutcome' };
    case 'already-in-progress':
      return { key: 'prepayment.charge.alreadyInProgress' };
    case 'already-charged':
      return { key: 'prepayment.charge.alreadyCharged' };
    case 'too-recent':
      return { key: 'prepayment.verify.tooRecent' };
    case 'no-claim':
      return { key: 'prepayment.verify.noClaim' };
    case 'other-claim':
      return { key: 'prepayment.verify.otherClaim' };
    case 'charge-accepted':
      return { key: 'prepayment.verify.accepted' };
    case 'invalid-document':
    case 'invalid-write':
    case 'too-large':
    case 'quota-exceeded':
    case 'not-installed':
    case 'unsupported':
    case 'disposed':
    case 'too-many-pages':
    case 'failed':
      return { key: 'prepayment.storage.failed' };
  }
}

/** Why the money actions cannot run: the settings, or no operator id. */
export type MoneyBlocker = Text | null;

/**
 * Why the money actions (charge, verify, retry, refund) are disabled: settings loading, not
 * readable or invalid (listing the keys to fix), or an operator without an id.
 *
 * @param settings - The settings query: `undefined` while loading, `null` when it failed.
 * @param userId - `getCurrentUser().id`.
 * @returns The reason, `null` when they can run.
 */
export function moneyBlocker(
  settings: SettingsResult | null | undefined,
  userId: string | null,
): MoneyBlocker {
  if (settings === undefined) return { key: 'common.loading' };
  if (settings === null) return { key: 'settings.unavailable' };
  if (!settings.ok) {
    return {
      key: 'prepayment.blocked.settings',
      params: { keys: [...new Set(settings.issues.map((issue) => issue.key))].join(', ') },
    };
  }
  if (!userId) return { key: 'prepayment.blocked.noUser' };
  return null;
}

/**
 * {@link moneyBlocker} as a final text, for the reason of a disabled action: the settings to fix
 * are named with their problem ("dayRate (invalid value)").
 *
 * @param settings - The settings query: `undefined` while loading, `null` when it failed.
 * @param userId - `getCurrentUser().id`.
 * @param t - Translation.
 * @returns The reason, `null` when the money actions can run.
 */
export function moneyBlockerReason(
  settings: SettingsResult | null | undefined,
  userId: string | null,
  t: (key: MessageKey, params?: MessageParams) => string,
): string | null {
  const blocker = moneyBlocker(settings, userId);
  if (blocker === null) return null;
  if (settings && !settings.ok && blocker.key === 'prepayment.blocked.settings') {
    const named = new Map<string, string>();
    for (const issue of settings.issues) {
      if (!named.has(issue.key)) named.set(issue.key, `${issue.key} (${t(`settings.issue.${issue.problem}`)})`);
    }
    return t(blocker.key, { keys: [...named.values()].join(', ') });
  }
  return t(blocker.key, blocker.params);
}
