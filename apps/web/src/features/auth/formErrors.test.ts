import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '@baby-tracker/shared';
import { ApiError } from '../../services/apiClient.js';
import { fieldErrorsFromApiError, fieldErrorsFromZod } from './formErrors.js';

describe('fieldErrorsFromZod', () => {
  it('reports one message per field from the shared schema', () => {
    const parsed = registerSchema.safeParse({ email: 'nope', password: 'short', displayName: '' });
    expect(parsed.success).toBe(false);

    const errors = fieldErrorsFromZod(parsed.error!);

    expect(Object.keys(errors.fields).sort()).toEqual(['displayName', 'email', 'password']);
    expect(errors.fields.password).toContain('10 characters');
  });

  it('accepts input the schema considers valid', () => {
    expect(
      loginSchema.safeParse({ email: 'Anahit@Example.com', password: 'a-real-password' }).success,
    ).toBe(true);
  });
});

describe('fieldErrorsFromApiError', () => {
  it('maps a 422 onto the offending fields', () => {
    const error = new ApiError(422, 'VALIDATION_FAILED', 'nope', [
      { path: 'email', message: 'Invalid email address' },
      { path: 'password', message: 'Password must be at least 10 characters' },
    ]);

    const errors = fieldErrorsFromApiError(error);

    expect(errors.fields).toEqual({
      email: 'Invalid email address',
      password: 'Password must be at least 10 characters',
    });
    expect(errors.messageKey).toBe('auth.errors.validationFailed');
  });

  it('puts a taken email under the email field', () => {
    const errors = fieldErrorsFromApiError(new ApiError(409, 'EMAIL_TAKEN', 'taken'));

    expect(errors.messageKey).toBe('auth.errors.emailTaken');
    expect(errors.messageField).toBe('email');
  });

  it('keeps wrong credentials off the password field, so nothing is confirmed', () => {
    const errors = fieldErrorsFromApiError(new ApiError(401, 'INVALID_CREDENTIALS', 'nope'));

    expect(errors.messageKey).toBe('auth.errors.invalidCredentials');
    expect(errors.messageField).toBeUndefined();
    expect(errors.fields).toEqual({});
  });

  it('handles a rate limit, an unknown code and a non-API failure', () => {
    expect(fieldErrorsFromApiError(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'x')).messageKey).toBe(
      'auth.errors.tooManyAttempts',
    );
    expect(fieldErrorsFromApiError(new ApiError(500, 'INTERNAL_ERROR', 'x')).messageKey).toBe(
      'auth.errors.unexpected',
    );
    expect(fieldErrorsFromApiError(new Error('offline')).messageKey).toBe('auth.errors.unexpected');
  });

  it('ignores malformed validation details instead of throwing', () => {
    const error = new ApiError(422, 'VALIDATION_FAILED', 'nope', 'not-an-array');
    expect(fieldErrorsFromApiError(error).fields).toEqual({});
  });
});
