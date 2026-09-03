import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { loginSchema } from '@baby-tracker/shared';
import { Button } from '../../components/ui/Button.js';
import { TextField } from '../../components/ui/TextField.js';
import { useAuth } from './AuthContext.js';
import { AuthLayout } from './AuthLayout.js';
import { fieldErrorsFromApiError, fieldErrorsFromZod, type FormErrors } from './formErrors.js';
import { AFTER_LOGIN_PATH } from './routeAccess.js';

const NO_ERRORS: FormErrors = { fields: {} };

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors(NO_ERRORS);

    // Client-side against the very schema the API validates with.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      await login(parsed.data);
      const from = (location.state as { from?: string } | null)?.from;
      await navigate(from ?? AFTER_LOGIN_PATH, { replace: true });
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
    <AuthLayout title={t('auth.login.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formMessage ? (
          <p role="alert" className="rounded-card bg-accent-soft px-3 py-2 text-sm text-critical">
            {formMessage}
          </p>
        ) : null}

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
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={messageFor('password')}
          disabled={submitting}
          required
        />

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="font-medium text-accent underline">
          {t('auth.login.goRegister')}
        </Link>
      </p>
    </AuthLayout>
  );
}
