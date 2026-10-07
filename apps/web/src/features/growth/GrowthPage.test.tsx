import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whoLmsAt } from '@baby-tracker/shared/growth';
import {
  type Baby,
  type FamilyWithRole,
  type GrowthMeasurement,
  type PublicUser,
} from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext.js';
import { TodayPage } from '../tracker/TodayPage.js';
import { GrowthPage } from './GrowthPage.js';

/**
 * The growth screen through its real query layer, with only `fetch` replaced —
 * the same arrangement as TodayPage.test.tsx.
 */

const FAMILY_ID = 'family-1';
const ANI_ID = 'baby-ani';

const family: FamilyWithRole = {
  id: FAMILY_ID,
  name: 'Sultanova',
  createdBy: 'user-1',
  role: 'OWNER',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const ani = (overrides: Partial<Baby> = {}): Baby => ({
  id: ANI_ID,
  familyId: FAMILY_ID,
  name: 'Ani',
  birthDate: '2026-06-01T00:00:00.000Z',
  gender: 'FEMALE',
  createdAt: '2026-06-01T09:00:00.000Z',
  updatedAt: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

const measurement = (
  id: string,
  measuredOn: string,
  values: Partial<GrowthMeasurement>,
): GrowthMeasurement => ({
  id,
  familyId: FAMILY_ID,
  babyId: ANI_ID,
  measuredOn: `${measuredOn}T00:00:00.000Z`,
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-01T09:00:00.000Z',
  ...values,
});

/** WHO girls' weight median at 30 days, in grams — the 50th percentile exactly. */
const MEDIAN_GIRL_30D_GRAMS = Math.round((whoLmsAt('weight', 'FEMALE', 30)?.m ?? 0) * 1000);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Routes {
  babies?: Baby[];
  growth?: GrowthMeasurement[];
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubApi({ babies = [ani()], growth = [] }: Routes = {}): void {
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';

    if (/\/growth\/[^/]+$/.test(url)) {
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json({ measurement: growth[0] }));
    }
    if (url.endsWith('/growth')) {
      if (method === 'POST')
        return Promise.resolve(json({ measurement: measurement('new', '2026-07-01', {}) }, 201));
      return Promise.resolve(json({ measurements: growth }));
    }
    if (/\/babies\/[^/]+$/.test(url) && method === 'PATCH') {
      return Promise.resolve(json({ baby: babies[0] }));
    }
    if (url.endsWith('/events')) return Promise.resolve(json({ events: [] }));
    if (url.endsWith('/babies')) return Promise.resolve(json({ babies }));
    if (url.endsWith('/families')) return Promise.resolve(json({ families: [family] }));
    throw new Error(`Unexpected request in test: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const sent = (method: string, pattern: RegExp): { url: string; body: unknown }[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === method && pattern.test(String(call[0])),
    )
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit).body ?? 'null')) as unknown,
    }));

const user: PublicUser = {
  id: 'user-1',
  email: 'parent@example.com',
  displayName: 'Parent',
  locale: 'en',
  timezone: 'Asia/Yerevan',
  units: { weight: 'kg', length: 'cm', volume: 'ml' },
  createdAt: '2026-08-01T09:00:00.000Z',
};

function renderPage(page: ReactNode): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user,
    register: () => Promise.resolve(),
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>{page}</MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetSession();
  resetRefreshState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GrowthPage', () => {
  it('shows an empty state when nothing has been measured', async () => {
    stubApi();
    renderPage(<GrowthPage />);
    expect(await screen.findByText(/No measurements for Ani yet/)).toBeDefined();
  });

  it('shows the latest value, the change and the WHO percentile — and no verdict', async () => {
    stubApi({
      growth: [
        measurement('m1', '2026-06-01', { weightGrams: 3200 }),
        measurement('m2', '2026-07-01', { weightGrams: MEDIAN_GIRL_30D_GRAMS, lengthMm: 540 }),
      ],
    });
    renderPage(<GrowthPage />);

    const weightRow = (await screen.findByRole('heading', { name: 'Latest' }))
      .closest('section')
      ?.querySelector('[data-indicator="weight"]') as HTMLElement;
    expect(within(weightRow).getByText(`${MEDIAN_GIRL_30D_GRAMS / 1000} kg`)).toBeDefined();
    expect(within(weightRow).getByText(/since Jun 1, 2026 \(30 d\)/)).toBeDefined();
    expect(within(weightRow).getByText('WHO percentile: 50')).toBeDefined();
    expect(screen.getByText(/They are not a diagnosis/)).toBeDefined();

    for (const verdict of [
      /underweight/i,
      /overweight/i,
      /normal/i,
      /healthy weight/i,
      /too (low|high)/i,
    ]) {
      expect(screen.queryByText(verdict)).toBeNull();
    }
  });

  it('draws the WHO chart with the baby’s points', async () => {
    stubApi({ growth: [measurement('m1', '2026-07-01', { weightGrams: 4200 })] });
    renderPage(<GrowthPage />);
    expect(
      await screen.findByRole('img', { name: /Weight chart for Ani, 1 measurements/ }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Jul 1, 2026: 4\.2 kg/ })).toBeDefined();
    expect(screen.getByText(/Grey band: WHO 2nd–98th percentile/)).toBeDefined();
  });

  it('saves a measurement in canonical units', async () => {
    stubApi();
    renderPage(<GrowthPage />);
    const userActions = userEvent.setup();

    await userActions.click(await screen.findByRole('button', { name: 'Add measurement' }));
    const date = screen.getByLabelText('Date');
    await userActions.clear(date);
    await userActions.type(date, '2026-07-01');
    await userActions.type(screen.getByLabelText('Weight (kg)'), '4,215');
    await userActions.type(screen.getByLabelText('Head circumference (cm)'), '37.2');
    await userActions.click(screen.getByLabelText('Doctor'));
    await userActions.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sent('POST', /\/growth$/)).toHaveLength(1);
    });
    expect(sent('POST', /\/growth$/)[0]?.body).toEqual({
      measuredOn: '2026-07-01',
      weightGrams: 4215,
      headCircumferenceMm: 372,
      source: 'DOCTOR',
    });
  });

  it('refuses a value typed in the wrong unit, and an empty form, without a request', async () => {
    stubApi();
    renderPage(<GrowthPage />);
    const userActions = userEvent.setup();

    await userActions.click(await screen.findByRole('button', { name: 'Add measurement' }));
    await userActions.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter at least one of weight');

    await userActions.type(screen.getByLabelText('Weight (kg)'), '4200');
    await userActions.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/check the unit \(kg\)/)).toBeDefined();
    expect(sent('POST', /\/growth$/)).toHaveLength(0);
  });

  it('asks for birth date and sex, and saves them with weeks at birth', async () => {
    stubApi({ babies: [ani({ birthDate: undefined, gender: undefined })] });
    renderPage(<GrowthPage />);
    const userActions = userEvent.setup();

    await userActions.click(await screen.findByRole('button', { name: 'Add details' }));
    await userActions.type(screen.getByLabelText('Birth date (optional)'), '2026-06-01');
    await userActions.click(screen.getByLabelText('Girl'));
    await userActions.type(screen.getByLabelText('Weeks'), '35');
    await userActions.type(screen.getByLabelText('Days'), '4');
    await userActions.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sent('PATCH', /\/babies\/baby-ani$/)).toHaveLength(1);
    });
    expect(sent('PATCH', /\/babies\/baby-ani$/)[0]?.body).toEqual({
      name: 'Ani',
      birthDate: '2026-06-01T00:00:00.000Z',
      gender: 'FEMALE',
      gestationalAge: { weeks: 35, days: 4 },
    });
  });

  it('labels a preterm comparison as corrected age', async () => {
    stubApi({
      babies: [ani({ gestationalAge: { weeks: 34, days: 0 } })],
      growth: [measurement('m1', '2026-08-15', { weightGrams: 4000 })],
    });
    renderPage(<GrowthPage />);
    // 75 days old, 42 days early → 33 days corrected.
    expect(await screen.findByText(/corrected age 4 wk/)).toBeDefined();
    expect(screen.getByText('Corrected age (months)')).toBeDefined();
  });

  it('edits with null for a cleared field, and deletes after confirming', async () => {
    const stored = measurement('m1', '2026-07-01', { weightGrams: 4200, lengthMm: 540 });
    stubApi({ growth: [stored] });
    renderPage(<GrowthPage />);
    const userActions = userEvent.setup();

    await userActions.click(
      await screen.findByRole('button', { name: 'Edit measurement from Jul 1, 2026' }),
    );
    await userActions.clear(screen.getByLabelText('Length (cm)'));
    await userActions.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sent('PATCH', /\/growth\/m1$/)).toHaveLength(1);
    });
    expect(sent('PATCH', /\/growth\/m1$/)[0]?.body).toMatchObject({
      weightGrams: 4200,
      lengthMm: null,
    });

    await userActions.click(
      await screen.findByRole('button', { name: 'Delete measurement from Jul 1, 2026' }),
    );
    expect(sent('DELETE', /\/growth\/m1$/)).toHaveLength(0);
    await userActions.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(sent('DELETE', /\/growth\/m1$/)).toHaveLength(1);
    });
  });
});

describe('Today’s measurement shortcut', () => {
  it('opens the growth form for the selected baby and confirms the save', async () => {
    stubApi();
    renderPage(<TodayPage />);
    const userActions = userEvent.setup();

    await userActions.click(await screen.findByRole('button', { name: 'Add measurement' }));
    expect(screen.getByRole('heading', { name: 'Measurement for Ani' })).toBeDefined();
    await userActions.type(screen.getByLabelText('Weight (kg)'), '4.3');
    await userActions.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('status')).textContent).toContain('Measurement saved.');
    expect(screen.getByRole('link', { name: 'See growth' }).getAttribute('href')).toBe('/health');
    expect(sent('POST', /\/babies\/baby-ani\/growth$/)[0]?.body).toMatchObject({
      weightGrams: 4300,
    });
  });
});
