import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyText, button, click, dialogShown } from '../../../test/dom';
import { renderInWidget } from '../../../test/render';
import { createI18n } from '../../../i18n';
import { DialogFrame, TextAlert } from './DialogFrame';

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());
const i18n = createI18n('en_GB');

describe('DialogFrame', () => {
  it('shows the title, the content and closes', async () => {
    const onClose = vi.fn();
    const view = await renderInWidget(<DialogFrame title="Title" onClose={onClose} i18n={i18n} actions={<button type="button">Go</button>}>Body</DialogFrame>);
    unmount = view.unmount;
    await dialogShown();
    expect(bodyText()).toContain('TitleBody');
    click('Close');
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot be closed while a call runs', async () => {
    const view = await renderInWidget(<DialogFrame title="T" onClose={() => undefined} busy i18n={i18n}>B</DialogFrame>);
    unmount = view.unmount;
    await dialogShown();
    expect(button('Close')?.disabled).toBe(true);
    expect(document.body.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});

describe('TextAlert', () => {
  it('translates its message and announces errors', async () => {
    const view = await renderInWidget(<TextAlert severity="error" text={{ key: 'prepayment.storage.gone' }} i18n={i18n} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('These data are no longer available.'));
  });
});
