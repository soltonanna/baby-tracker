import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card.js';
import { LanguageChoice, ThemeChoice } from './PreferenceControls.js';

/**
 * The "More" tab. For now it holds the device preferences; family management
 * joins it in Phase 6, which the note at the bottom keeps honest about.
 */
export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Card title={t('settings.title')}>
        <div className="space-y-5">
          <LanguageChoice />
          <ThemeChoice />
        </div>
      </Card>
      <p className="px-1 text-sm text-muted">{t('placeholder.comingIn', { phase: 'Phase 6' })}</p>
    </div>
  );
}
