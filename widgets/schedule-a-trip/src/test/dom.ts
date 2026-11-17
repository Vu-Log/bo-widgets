// Test helpers: find and drive the elements a dialog renders (MUI portals go to document.body).
import { vi } from 'vitest';

/** The text of the whole document. */
export const bodyText = (): string => document.body.textContent ?? '';

/** The button whose text is `name`, or `undefined`. */
export const button = (name: string): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name);

/** Clicks the button whose text is `name`; throws when there is none. */
export function click(name: string): void {
  const target = button(name);
  if (!target) throw new Error(`No button "${name}" in: ${bodyText()}`);
  target.click();
}

/** Types a value into an input or a textarea, as React sees it. */
export function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The first input or textarea of the open dialog. */
export function field(): HTMLInputElement | HTMLTextAreaElement {
  const element = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>('[role="dialog"] input, [role="dialog"] textarea');
  if (!element) throw new Error('No field in the dialog');
  return element;
}

/** Waits until a dialog is rendered. */
export const dialogShown = (): Promise<void> =>
  vi.waitFor(() => {
    if (!document.body.querySelector('[role="dialog"]')) throw new Error('No dialog yet');
  });
