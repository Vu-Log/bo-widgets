// Test helper: renders a component inside the widget providers, connected to a fake BO.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetProvider } from '@vulog/bo-widget-react';
import { connect } from '@vulog/bo-widget-sdk';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { fakeBo } from './fake-bo';

/**
 * Renders `ui` in `WidgetProvider` (and a fresh QueryClient without retries) in a container of the
 * document. Call `unmount` after the test.
 */
export async function renderInWidget(ui: ReactNode, api: object = fakeBo().api) {
  const client = await connect({ vulogBo: api });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (node: ReactNode) =>
    root.render(
      <WidgetProvider client={client}>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </WidgetProvider>,
    );
  render(ui);
  return {
    container,
    queryClient,
    client,
    /** Renders another element in place, keeping the state of the tree. */
    rerender: render,
    unmount: () => {
      root.unmount();
      container.remove();
      client.disconnect();
    },
  };
}
