import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../test/fake-bo';
import { fieldLabelled, renderInSection, typeInto } from '../../test/section';
import { DateFields, isPickupComplete, PickupFields, type DatesValue, type PickupValue } from './fields';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

describe('isPickupComplete', () => {
  it('needs both coordinates and a valid radius', () => {
    expect(isPickupComplete({ latitude: 1, longitude: 2, radius: 500 })).toBe(true);
    expect(isPickupComplete({ latitude: null, longitude: 2, radius: 500 })).toBe(false);
    expect(isPickupComplete({ latitude: 1, longitude: 2, radius: 0 })).toBe(false);
  });
});

describe('DateFields', () => {
  it('shows and reads the dates in the zone of the fleet', async () => {
    const onChange = vi.fn();
    const value: DatesValue = { start: new Date('2026-03-10T08:00:00Z'), plannedReturn: null };
    const view = await renderInSection(<DateFields value={value} onChange={onChange} errors={{ plannedReturn: 'Too early' }} />, {
      value: { timeZone: 'Asia/Tokyo' },
    });
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Start')?.value).toBe('2026-03-10T17:00'));
    expect(document.body.textContent).toContain('Time zone: Asia/Tokyo');
    expect(document.body.textContent).toContain('Too early');
    typeInto(fieldLabelled('Planned return')!, '2026-03-10T19:00');
    expect(onChange).toHaveBeenLastCalledWith({ start: value.start, plannedReturn: new Date('2026-03-10T10:00:00Z') });
  });
});

describe('PickupFields', () => {
  function Harness({ initial }: { initial: PickupValue }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <PickupFields value={value} onChange={setValue} />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  const output = () => JSON.parse(document.body.querySelector('output')?.textContent ?? '{}') as PickupValue;

  it('finds an address and takes its point', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ features: [{ place_name: '1 Example Street', center: [2.35, 48.85] }] }),
    );
    const view = await renderInSection(<Harness initial={{ latitude: null, longitude: null, radius: 500 }} />, {
      value: { mapboxToken: 'pk.test' },
    });
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Search an address')).toBeDefined());
    const input = fieldLabelled('Search an address') as HTMLInputElement;
    input.focus();
    typeInto(input, '1 example');
    await vi.waitFor(() => expect(document.body.querySelector('[role="option"]')).not.toBeNull(), { timeout: 3000 });
    document.body.querySelector<HTMLElement>('[role="option"]')?.click();
    await vi.waitFor(() => expect(output()).toEqual({ latitude: 48.85, longitude: 2.35, radius: 500 }));
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toContain('/mapbox.places/1%20example.json');
    expect(document.body.querySelector('svg[role="img"]')).not.toBeNull();
  });

  it('types the coordinates and the radius without a token', async () => {
    const view = await renderInSection(<Harness initial={{ latitude: 48.85, longitude: 2.35, radius: 500 }} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Latitude')).toBeDefined());
    expect(fieldLabelled('Search an address')).toBeUndefined();
    typeInto(fieldLabelled('Latitude')!, '45.5');
    typeInto(fieldLabelled('Radius (m)')!, '12.5');
    await vi.waitFor(() => expect(output()).toEqual({ latitude: 45.5, longitude: 2.35, radius: 12.5 }));
    expect(document.body.textContent).toContain('A whole number of meters');
    typeInto(fieldLabelled('Longitude')!, 'x');
    await vi.waitFor(() => expect(output().longitude).toBeNull());
  });

  it('moves the point where the map is clicked', async () => {
    const view = await renderInSection(<Harness initial={{ latitude: 48.85, longitude: 2.35, radius: 500 }} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(document.body.querySelector('svg[role="img"]')).not.toBeNull());
    const svg = document.body.querySelector('svg[role="img"]') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 110 }));
    await vi.waitFor(() => expect(output().longitude).toBeGreaterThan(2.35));
  });

  it('says when the address search fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const view = await renderInSection(<Harness initial={{ latitude: null, longitude: null, radius: 500 }} />, {
      value: { mapboxToken: 'pk.test' },
    });
    unmount = view.unmount;
    await vi.waitFor(() => expect(fieldLabelled('Search an address')).toBeDefined());
    const input = fieldLabelled('Search an address') as HTMLInputElement;
    input.focus();
    typeInto(input, 'somewhere');
    await vi.waitFor(() => expect(document.body.textContent).toContain('The address search failed.'), { timeout: 3000 });
  });
});
