import { Alert } from '@mui/material';
import { BookingSection } from './features/BookingSection';
import { useI18n } from './i18n';
import { WidgetQueryProvider } from './query/WidgetQueryProvider';
import { useWidgetSettings } from './settings';
import { ConfigurationBanner } from './ui/ConfigurationBanner';

/** The state of the settings: a banner when they are invalid or cannot be read. */
function SettingsStatus() {
  const { t } = useI18n();
  const settings = useWidgetSettings();
  if (settings.isError) {
    return (
      <Alert severity="error" sx={{ flex: 'none', borderRadius: 0 }} title={settings.error.message}>
        {t('settings.unavailable')}
      </Alert>
    );
  }
  if (settings.data && !settings.data.ok)
    return <ConfigurationBanner issues={settings.data.issues} />;
  return null;
}

/** The content of the widget. It fills the element in a column: only the main area scrolls. */
export default function App() {
  return (
    <WidgetQueryProvider>
      <SettingsStatus />
      <BookingSection />
    </WidgetQueryProvider>
  );
}
