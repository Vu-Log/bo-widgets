import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click, dialogShown, field, typeInto } from '../../../test/dom';
import { hostError } from '../../../test/fake-bo';
import { doc, renderWithBilling, row } from '../../../test/prepayment-fixtures';
import { NotesDialog } from './NotesDialog';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

describe('NotesDialog', () => {
  it('creates the document with the notes and closes', async () => {
    const onClose = vi.fn();
    const rendered = await renderWithBilling(<NotesDialog ctx={row({ state: null })} onClose={onClose} />);
    unmount = rendered.view.unmount;
    await dialogShown();

    typeInto(field(), 'Child seat');
    click('Save');

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(rendered.stored()?.value).toMatchObject({ internalNotes: 'Child seat', allocationProcessed: false });
  });

  it('starts from the notes saved and counts the characters', async () => {
    const rendered = await renderWithBilling(<NotesDialog ctx={row({ state: doc({ internalNotes: 'Hello' }) })} onClose={() => undefined} />, { stored: { internalNotes: 'Hello' } });
    unmount = rendered.view.unmount;
    await dialogShown();
    expect((field() as HTMLTextAreaElement).value).toBe('Hello');
    expect(bodyText()).toContain('5 / 500');
    typeInto(field(), 'x'.repeat(501));
    await vi.waitFor(() => expect(button('Save')?.disabled).toBe(true));
  });

  it('shows a storage failure and stays open', async () => {
    const onClose = vi.fn();
    const rendered = await renderWithBilling(<NotesDialog ctx={row({ state: null })} onClose={onClose} />);
    unmount = rendered.view.unmount;
    await dialogShown();
    rendered.bo.storage.api.set.mockRejectedValueOnce(hostError('rate-limited', 429));
    rendered.bo.storage.api.set.mockRejectedValueOnce(hostError('rate-limited', 429));
    click('Save');
    await vi.waitFor(() => expect(bodyText()).toContain('Too many changes at once'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
