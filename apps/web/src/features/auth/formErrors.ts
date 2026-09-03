import type { ZodError } from 'zod';
import { ApiError } from '../../services/apiClient.js';

/**
 * Turns validation failures — from the shared Zod schemas client-side, or from
 * the API — into something a form can render.
 *
 * Pure and translation-free: it returns i18n *keys* for whole-form messages and
 * raw text for field messages, and the page decides how to display them.
 */
export interface FormErrors {
  /** Field name → message, ready to show under the input. */
  fields: Record<string, string>;
  /** i18n key for a message about the submission, if any. */
  messageKey?: string;
  /** When set, `messageKey` belongs under this field rather than above the form. */
  messageField?: string;
}

const EMPTY: FormErrors = { fields: {} };

export function fieldErrorsFromZod(error: ZodError): FormErrors {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path.join('.');
    // First issue per field wins: showing one clear problem beats a pile.
    if (field && !(field in fields)) {
      fields[field] = issue.message;
    }
  }

  return { fields };
}

/**
 * Maps the API's error codes onto the form.
 *
 * `EMAIL_TAKEN` belongs on the email input; a wrong password or a rate limit
 * belongs to the form as a whole — attaching "incorrect" to the password field
 * would quietly confirm that the email exists, which the API deliberately
 * does not reveal.
 */
export function fieldErrorsFromApiError(error: unknown): FormErrors {
  if (!(error instanceof ApiError)) {
    return { ...EMPTY, messageKey: 'auth.errors.unexpected' };
  }

  switch (error.code) {
    case 'VALIDATION_FAILED':
      return {
        fields: fieldsFromValidationDetails(error.details),
        messageKey: 'auth.errors.validationFailed',
      };
    case 'EMAIL_TAKEN':
      return { fields: {}, messageKey: 'auth.errors.emailTaken', messageField: 'email' };
    case 'INVALID_CREDENTIALS':
      return { fields: {}, messageKey: 'auth.errors.invalidCredentials' };
    case 'TOO_MANY_ATTEMPTS':
      return { fields: {}, messageKey: 'auth.errors.tooManyAttempts' };
    default:
      return { fields: {}, messageKey: 'auth.errors.unexpected' };
  }
}

/** The API returns `details: [{ path, message }]` for a 422. */
function fieldsFromValidationDetails(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const entry of details) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { path?: unknown }).path === 'string' &&
      typeof (entry as { message?: unknown }).message === 'string'
    ) {
      const { path, message } = entry as { path: string; message: string };
      if (path && !(path in fields)) {
        fields[path] = message;
      }
    }
  }
  return fields;
}
