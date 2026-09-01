import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card.js';

export interface PlaceholderPageProps {
  titleKey: string;
  phase: string;
}

/** Honest scaffolding: the navigation exists, the screen behind it does not yet. */
export function PlaceholderPage({ titleKey, phase }: PlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <Card title={t(titleKey)}>
      <p className="text-muted">{t('placeholder.comingIn', { phase })}</p>
    </Card>
  );
}
