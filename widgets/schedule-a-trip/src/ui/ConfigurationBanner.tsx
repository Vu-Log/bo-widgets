import { Alert, AlertTitle, Box } from '@mui/material';
import { useI18n } from '../i18n';
import type { SettingsIssue } from '../settings';

/**
 * The warning shown when the settings of the installation are invalid: the prepayment actions are
 * disabled until an administrator fixes the settings listed.
 *
 * @param props - The issues of `parseSettings`.
 * @returns The banner.
 */
export function ConfigurationBanner({ issues }: { readonly issues: readonly SettingsIssue[] }) {
  const { t } = useI18n();
  return (
    <Alert severity="warning" sx={{ flex: 'none', borderRadius: 0 }}>
      <AlertTitle>{t('settings.incomplete.title')}</AlertTitle>
      {t('settings.incomplete.details')}
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {issues.map((issue) => (
          <li key={`${issue.key}:${issue.message}`} title={issue.message}>
            <code>{issue.key}</code>: {t(`settings.issue.${issue.problem}`)}
          </li>
        ))}
      </Box>
    </Alert>
  );
}
