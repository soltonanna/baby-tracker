import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { familyNameSchema } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { Card } from '../../components/ui/Card.js';
import { TextField } from '../../components/ui/TextField.js';
import { queryKeys } from '../../services/queryKeys.js';
import { createFamily } from './api.js';

/**
 * Creating the first family — the one thing a new account can do before it can
 * do anything else.
 *
 * It lives next to the tracker forms rather than in an onboarding feature of
 * its own: it is the Today screen's empty state, it uses the same family API
 * `TodayPage` already reads from, and there is nothing else to onboard yet.
 */

export interface CreateFamilyFormProps {
  /** Called once the family exists and the families query has been refreshed. */
  onCreated?: () => void;
}

export function CreateFamilyForm({ onCreated }: CreateFamilyFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const create = useMutation({
    mutationFn: (input: { name: string }) => createFamily(input),
    onSuccess: async () => {
      // Awaited, so the screen only leaves this form once the families query
      // holds the new family — no reload, and no flash of the empty state.
      await queryClient.invalidateQueries({ queryKey: queryKeys.families });
      onCreated?.();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // The shared schema is the contract the API validates against, so the same
    // trim and the same bounds decide here.
    const parsed = familyNameSchema.safeParse(name);

    if (!parsed.success) {
      setNameError(
        name.trim().length === 0
          ? t('today.family.errors.required')
          : t('today.family.errors.tooLong'),
      );
      return;
    }

    setNameError(undefined);
    // The trimmed value, so what is created is what was validated.
    create.mutate({ name: parsed.data });
  }

  return (
    <Card title={t('today.family.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <p className="text-sm text-muted">{t('today.family.intro')}</p>

        {create.isError ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {t('today.family.errors.createFailed')}
          </p>
        ) : null}

        <TextField
          label={t('today.family.name')}
          name="name"
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          error={nameError}
          disabled={create.isPending}
          required
        />

        {/* Nothing is cleared on failure: a failed create is retried, not retyped. */}
        <Button type="submit" fullWidth disabled={create.isPending}>
          {create.isPending ? t('today.family.submitting') : t('today.family.submit')}
        </Button>
      </form>
    </Card>
  );
}
