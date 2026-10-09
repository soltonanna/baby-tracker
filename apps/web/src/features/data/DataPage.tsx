import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { familyDataSchema, type FamilyDataCounts } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { queryKeys } from '../../services/queryKeys.js';
import { fetchFamilies } from '../tracker/api.js';
import { clearFamilyData, downloadJson, fetchFamilyDataExport, importFamilyData } from './api.js';

/**
 * "More" → Your data: export a backup, import a file, or clear the children's
 * data. The account — sign-in, family, membership — is never part of any of
 * these, so none of them can sign the parent out.
 *
 * Import and clear are destructive, so each is a two-step action with the
 * consequence spelled out before the danger button appears, and both are
 * offered to the family's owner only (the API enforces the same rule).
 */
export function DataPage() {
  const { t } = useTranslation();
  const familiesQuery = useQuery({ queryKey: queryKeys.families, queryFn: fetchFamilies });
  const family = familiesQuery.data?.[0];

  if (familiesQuery.isPending) {
    return (
      <Card title={t('data.title')}>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }
  if (familiesQuery.isError) {
    return (
      <Card title={t('data.title')}>
        <p role="alert" className="text-sm text-critical">
          {t('data.errors.loadFailed')}
        </p>
      </Card>
    );
  }
  if (family === undefined) {
    return (
      <Card title={t('data.title')}>
        <p className="text-muted">{t('data.noFamily')}</p>
      </Card>
    );
  }

  const isOwner = family.role === 'OWNER';

  return (
    <div className="space-y-4">
      <ExportSection familyId={family.id} />
      {isOwner ? (
        <>
          <ImportSection familyId={family.id} />
          <ClearSection familyId={family.id} />
        </>
      ) : (
        <Card title={t('data.import.title')}>
          <p className="text-sm text-muted">{t('data.ownerOnly')}</p>
        </Card>
      )}
    </div>
  );
}

function useCountsText(): (counts: FamilyDataCounts) => string {
  const { t } = useTranslation();
  return (counts) =>
    [
      t('data.counts.babies', { count: counts.babies }),
      t('data.counts.events', { count: counts.events }),
      t('data.counts.measurements', { count: counts.measurements }),
    ].join(' · ');
}

function ExportSection({ familyId }: { familyId: string }) {
  const { t } = useTranslation();
  const countsText = useCountsText();

  const exportData = useMutation({
    mutationFn: () => fetchFamilyDataExport(familyId),
    onSuccess: (data) => {
      downloadJson(data, `baby-tracker-${data.exportedAt.slice(0, 10)}.json`);
    },
  });

  return (
    <Card title={t('data.export.title')}>
      <p className="mb-3 text-sm text-muted">{t('data.export.description')}</p>
      <Button
        variant="secondary"
        fullWidth
        disabled={exportData.isPending}
        onClick={() => {
          exportData.mutate();
        }}
      >
        {exportData.isPending ? t('data.export.working') : t('data.export.action')}
      </Button>
      {exportData.isSuccess ? (
        <p role="status" className="mt-2 text-sm text-ink">
          {t('data.export.done', {
            counts: countsText({
              babies: exportData.data.babies.length,
              events: exportData.data.events.length,
              measurements: exportData.data.measurements.length,
            }),
          })}
        </p>
      ) : null}
      {exportData.isError ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {t('data.errors.exportFailed')}
        </p>
      ) : null}
    </Card>
  );
}

interface PendingImport {
  fileName: string;
  contents: string;
  counts: FamilyDataCounts;
}

/** Reads and checks a file before anything is sent, so a wrong file never gets as far as "replace". */
async function readImportFile(file: File): Promise<PendingImport | { error: string }> {
  let raw: unknown;
  const contents = await file.text();
  try {
    raw = JSON.parse(contents);
  } catch {
    return { error: 'notJson' };
  }
  const parsed = familyDataSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: 'invalid' };
  }
  return {
    fileName: file.name,
    contents,
    counts: {
      babies: parsed.data.babies.length,
      events: parsed.data.events.length,
      measurements: parsed.data.measurements.length,
    },
  };
}

function ImportSection({ familyId }: { familyId: string }) {
  const { t } = useTranslation();
  const countsText = useCountsText();
  const queryClient = useQueryClient();
  const inputId = useId();
  const questionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<PendingImport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const runImport = useMutation({
    mutationFn: (contents: string) => importFamilyData(familyId, contents),
    onSuccess: async () => {
      setPending(null);
      // Every screen's data belonged to the babies that were just replaced.
      await queryClient.invalidateQueries();
    },
  });

  function resetInput(): void {
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    runImport.reset();
    setPending(null);
    setFileError(null);
    if (!file) return;

    const result = await readImportFile(file);
    if ('error' in result) {
      setFileError(t(`data.import.errors.${result.error}`));
      resetInput();
      return;
    }
    setPending(result);
  }

  return (
    <Card title={t('data.import.title')}>
      <p className="mb-3 text-sm text-muted">{t('data.import.description')}</p>

      <label
        htmlFor={inputId}
        className="inline-flex min-h-touch w-full cursor-pointer items-center justify-center rounded-full border border-tone-line bg-tone-soft px-5 text-base font-medium text-tone-ink active:brightness-95"
      >
        {t('data.import.choose')}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        disabled={runImport.isPending}
        onChange={(event) => {
          void handleFile(event);
        }}
      />

      {fileError === null ? null : (
        <p role="alert" className="mt-2 text-sm text-critical">
          {fileError}
        </p>
      )}

      {pending === null ? null : (
        <div
          role="group"
          aria-labelledby={questionId}
          className="mt-3 space-y-2 rounded-field bg-critical-soft p-3"
        >
          <p className="text-sm font-medium break-all text-ink">{pending.fileName}</p>
          <p className="text-sm text-ink">{countsText(pending.counts)}</p>
          <p id={questionId} className="text-sm text-ink">
            {t('data.import.confirm')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              fullWidth
              disabled={runImport.isPending}
              onClick={() => {
                runImport.mutate(pending.contents);
              }}
            >
              {runImport.isPending ? t('data.import.working') : t('data.import.action')}
            </Button>
            <Button
              variant="quiet"
              disabled={runImport.isPending}
              onClick={() => {
                setPending(null);
                runImport.reset();
                resetInput();
              }}
            >
              {t('data.cancel')}
            </Button>
          </div>
        </div>
      )}

      {runImport.isSuccess ? (
        <p role="status" className="mt-2 text-sm text-ink">
          {t('data.import.done', { counts: countsText(runImport.data) })}
        </p>
      ) : null}
      {runImport.isError ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {t('data.errors.importFailed')}
        </p>
      ) : null}
    </Card>
  );
}

function ClearSection({ familyId }: { familyId: string }) {
  const { t } = useTranslation();
  const countsText = useCountsText();
  const queryClient = useQueryClient();
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);

  const clear = useMutation({
    mutationFn: () => clearFamilyData(familyId),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries();
    },
  });

  return (
    <Card title={t('data.clear.title')}>
      <p className="mb-3 text-sm text-muted">{t('data.clear.description')}</p>

      {confirming ? (
        <div
          role="group"
          aria-labelledby={questionId}
          className="space-y-2 rounded-field bg-critical-soft p-3"
        >
          <p id={questionId} className="text-sm text-ink">
            {t('data.clear.confirm')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              fullWidth
              disabled={clear.isPending}
              onClick={() => {
                clear.mutate();
              }}
            >
              {clear.isPending ? t('data.clear.working') : t('data.clear.action')}
            </Button>
            <Button
              variant="quiet"
              autoFocus
              disabled={clear.isPending}
              onClick={() => {
                setConfirming(false);
                clear.reset();
              }}
            >
              {t('data.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        // Outlined in the alarming colour, not filled: this only opens the
        // question; the filled danger button is the answer to it.
        <button
          type="button"
          className="inline-flex min-h-touch w-full items-center justify-center rounded-full border border-critical px-5 text-base font-medium text-critical focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone active:bg-critical-soft"
          onClick={() => {
            clear.reset();
            setConfirming(true);
          }}
        >
          {t('data.clear.start')}
        </button>
      )}

      {clear.isSuccess ? (
        <p role="status" className="mt-2 text-sm text-ink">
          {t('data.clear.done', { counts: countsText(clear.data) })}
        </p>
      ) : null}
      {clear.isError ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {t('data.errors.clearFailed')}
        </p>
      ) : null}
    </Card>
  );
}
