import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../services/apiClient.js';
import { queryKeys } from '../../services/queryKeys.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';

interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  database: string;
  timestamp: string;
}

/**
 * Phase 0 proof that the whole stack is wired: browser -> Vite proxy -> API.
 * It will be replaced by the real dashboard in Phase 3.
 */
export function ApiStatusCard() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiFetch<HealthResponse>('/health'),
    retry: false,
  });

  return (
    <Card title={t('system.apiStatusTitle')}>
      {isPending ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner /> {t('system.checking')}
        </p>
      ) : isError ? (
        <p className="text-critical">{t('system.apiOffline')}</p>
      ) : (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">API</dt>
            <dd className="text-positive">{t('system.apiOnline')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t('system.database')}</dt>
            <dd className="text-ink">{data.database}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
