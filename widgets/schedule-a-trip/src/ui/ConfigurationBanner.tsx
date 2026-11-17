import { Alert, AlertTitle, Box } from '@mui/material';
import { useMessages } from '../i18n';
import type { SettingsIssue } from '../settings';

/**
 * The warning shown when the settings of the installation are invalid: the prepayment actions are
 * disabled until an administrator fixes the settings listed.
 *
 * @param props - The issues of `parseSettings`.
 * @returns The banner.
 */
export function ConfigurationBanner({ issues }: { readonly issues: readonly SettingsIssue[] }) {
  const t = useMessages();
  return (
    <Alert severity="warning" sx={{ flex: 'none', borderRadius: 0 }}>
      <AlertTitle>{t.configurationIncomplete}</AlertTitle>
      {t.configurationIncompleteDetails}
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {issues.map((issue) => (
          <li key={`${issue.key}:${issue.message}`}>
            <code>{issue.key}</code>: {issue.message}
          </li>
        ))}
      </Box>
    </Alert>
  );
}
