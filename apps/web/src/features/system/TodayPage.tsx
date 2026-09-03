import { useTranslation } from 'react-i18next';
import { ApiStatusCard } from './ApiStatusCard.js';
import { Card } from '../../components/ui/Card.js';

export function TodayPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <ApiStatusCard />
      <Card>
        <p className="text-muted">{t('system.noFeaturesYet')}</p>
      </Card>
    </div>
  );
}
