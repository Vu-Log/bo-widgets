import { Alert, Box, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { useState } from 'react';
import { LIST_TABS, type ListTab } from './domain/statuses';
import { useI18n } from './i18n';
import { WidgetQueryProvider } from './query/WidgetQueryProvider';
import { useWidgetSettings } from './settings';
import { ConfigurationBanner } from './ui/ConfigurationBanner';

const tabId = (tab: ListTab) => `schedule-a-trip-tab-${tab}`;
const panelId = (tab: ListTab) => `schedule-a-trip-panel-${tab}`;

/** The state of the settings: a banner when they are invalid or cannot be read. */
function SettingsStatus() {
  const { t } = useI18n();
  const settings = useWidgetSettings();
  if (settings.isError) {
    return (
      <Alert severity="error" sx={{ flex: 'none', borderRadius: 0 }}>
        {t('settings.unavailable')} {settings.error.message}
      </Alert>
    );
  }
  if (settings.data && !settings.data.ok)
    return <ConfigurationBanner issues={settings.data.issues} />;
  return null;
}

/** The header, the tabs of the booking list and the panel of the selected tab. */
function ScheduleATrip() {
  const { t } = useI18n();
  const [tab, setTab] = useState<ListTab>('upcoming');

  return (
    <>
      <Toolbar sx={{ flex: 'none', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" component="h1">
          {t('app.title')}
        </Typography>
      </Toolbar>
      <SettingsStatus />
      <Tabs
        value={tab}
        onChange={(_, value: ListTab) => setTab(value)}
        aria-label={t('tabs.label')}
        variant="scrollable"
        sx={{ flex: 'none', borderBottom: 1, borderColor: 'divider', px: 2 }}
      >
        {LIST_TABS.map((value) => (
          <Tab
            key={value}
            value={value}
            label={t(`tabs.${value}`)}
            id={tabId(value)}
            aria-controls={panelId(value)}
          />
        ))}
      </Tabs>
      <Box
        component="main"
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}
      >
        <Typography color="text.secondary">{t(`tabs.empty.${tab}`)}</Typography>
      </Box>
    </>
  );
}

/** The content of the widget. It fills the element in a column: only the main area scrolls. */
export default function App() {
  return (
    <WidgetQueryProvider>
      <ScheduleATrip />
    </WidgetQueryProvider>
  );
}
