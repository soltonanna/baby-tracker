import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { registerSchema } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import { useAuth } from './AuthContext.js';
import { AuthLayout } from './AuthLayout.js';
import { fieldErrorsFromApiError, fieldErrorsFromZod, type FormErrors } from './formErrors.js';
import { AFTER_LOGIN_PATH } from './routeAccess.js';
import { currentLocale } from '../../i18n/index.js';

const NO_ERRORS: FormErrors = { fields: {} };

/**
 * The browser's own time zone, when it is one the shared schema accepts.
 * Returning undefined lets the schema apply its default instead — every
 * timestamp in this product is displayed in a family time zone, so guessing
 * right at sign-up saves the parent a settings trip later.
 */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors(NO_ERRORS);

    const timezone = browserTimeZone();
    const parsed = registerSchema.safeParse({
      displayName,
      email,
      password,
      // The language the parent is reading the form in is the best guess for
      // the account's language too.
      locale: currentLocale(),
      ...(timezone ? { timezone } : {}),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      await register(parsed.data);
      await navigate(AFTER_LOGIN_PATH, { replace: true });
    } catch (error) {
      setErrors(fieldErrorsFromApiError(error));
      setSubmitting(false);
    }
  }

  const messageFor = (field: string): string | undefined =>
    errors.fields[field] ??
    (errors.messageField === field && errors.messageKey ? t(errors.messageKey) : undefined);

  const formMessage = errors.messageKey && !errors.messageField ? t(errors.messageKey) : undefined;

  return (
    <AuthLayout title={t('auth.register.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formMessage ? (
          <p
            role="alert"
            className="rounded-field bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {formMessage}
          </p>
        ) : null}

        <TextField
          label={t('auth.field.displayName')}
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={messageFor('displayName')}
          disabled={submitting}
          required
        />

        <TextField
          label={t('auth.field.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={messageFor('email')}
          disabled={submitting}
          required
        />

        <TextField
          label={t('auth.field.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={messageFor('password')}
          disabled={submitting}
          required
        />
        <p className="text-sm text-muted">{t('auth.register.passwordHint')}</p>

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {t('auth.register.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-accent-ink underline">
          {t('auth.register.goLogin')}
        </Link>
      </p>
    </AuthLayout>
  );
}
