import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card.js';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <Card title={t('errors.notFoundTitle')}>
      <p className="text-muted">{t('errors.notFoundBody')}</p>
    </Card>
  );
}
