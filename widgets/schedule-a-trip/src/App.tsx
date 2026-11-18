import { Alert, Button } from '@mui/material';
import { useBoClient, useBoContext } from '@vulog/bo-widget-react';
import { useEffect } from 'react';
import { BookingSection } from './features/BookingSection';
import {
  languageError,
  loadLanguage,
  resolveLanguage,
  useI18n,
  useLanguageStatus,
} from './i18n';
import { describeError } from './query/WidgetQueryProvider';
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

/**
 * The failure to load the texts of the language of the BO: the widget stays in English, says so,
 * logs it and offers a Retry.
 */
export function LanguageStatusBanner() {
  const { t } = useI18n();
  const bo = useBoClient();
  const language = resolveLanguage(useBoContext().locale);
  const status = useLanguageStatus(language);
  const error = status === 'failed' ? languageError(language) : null;
  useEffect(() => {
    if (error) {
      bo.log.error('The texts of the language could not be loaded', {
        language: error.language,
        ...describeError(error.cause),
      });
    }
  }, [bo, error]);
  if (!error) return null;
  return (
    <Alert
      severity="warning"
      sx={{ flex: 'none', borderRadius: 0 }}
      action={
        <Button
          color="inherit"
          size="small"
          // The failure is kept in the store again, and shown here again.
          onClick={() => void loadLanguage(language).catch(() => undefined)}
        >
          {t('grid.retry')}
        </Button>
      }
    >
      {t('i18n.loadFailed')}
    </Alert>
  );
}

/** The content of the widget. It fills the element in a column: only the main area scrolls. */
export default function App() {
  return (
    <WidgetQueryProvider>
      <LanguageStatusBanner />
      <SettingsStatus />
      <BookingSection />
    </WidgetQueryProvider>
  );
}
