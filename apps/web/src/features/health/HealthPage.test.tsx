import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMMUNIZATION_CATALOG_VERSION,
  IMMUNIZATION_SCHEDULE,
  type Baby,
  type FamilyWithRole,
  type HealthRecord,
  type PublicUser,
} from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext.js';
import { HealthPage } from './HealthPage.js';

/**
 * The Health page through its real query layer, with only `fetch` replaced —
 * the same arrangement as GrowthPage.test.tsx. The baby is born 100 days before
 * the test runs, so the schedule's statuses do not depend on the calendar date.
 */

const FAMILY_ID = 'family-1';
const ANI_ID = 'baby-ani';
const DAY = 86_400_000;

const isoDate = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

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
  birthDate: `${isoDate(-100)}T00:00:00.000Z`,
  gender: 'FEMALE',
  createdAt: '2026-06-01T09:00:00.000Z',
  updatedAt: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

const record = (id: string, overrides: Partial<HealthRecord> = {}): HealthRecord => ({
  id,
  familyId: FAMILY_ID,
  babyId: ANI_ID,
  category: 'vaccination',
  occurredAt: `${isoDate(-99)}T06:00:00.000Z`,
  name: 'Hepatitis B, birth dose',
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-01T09:00:00.000Z',
  ...overrides,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

function stubApi({
  babies = [ani()],
  records = [] as HealthRecord[],
}: { babies?: Baby[]; records?: HealthRecord[] } = {}): void {
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';

    if (/\/health\/[^/]+$/.test(url)) {
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json({ record: records[0] }));
    }
    if (url.endsWith('/health')) {
      if (method === 'POST') return Promise.resolve(json({ record: record('new') }, 201));
      return Promise.resolve(json({ records }));
    }
    if (url.endsWith('/growth')) return Promise.resolve(json({ measurements: [] }));
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

const sent = (method: string, pattern: RegExp): { url: string; body: Record<string, unknown> }[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === method && pattern.test(String(call[0])),
    )
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit).body ?? 'null')) as Record<string, unknown>,
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

function renderPage(page: ReactNode, path = '/health'): void {
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
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
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

describe('Health page tabs', () => {
  it('opens on Growth and switches to Records and Vaccinations', async () => {
    stubApi();
    renderPage(<HealthPage />);
    const actions = userEvent.setup();

    expect(await screen.findByText(/No measurements for Ani yet/)).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Growth', selected: true })).toBeDefined();

    await actions.click(screen.getByRole('tab', { name: 'Records' }));
    expect(await screen.findByText(/No health records for Ani yet/)).toBeDefined();

    await actions.click(screen.getByRole('tab', { name: 'Vaccinations' }));
    expect(await screen.findByText('Armenian vaccination schedule')).toBeDefined();
  });

  it('opens the tab named in the address', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=records');
    expect(await screen.findByText(/No health records for Ani yet/)).toBeDefined();
  });
});

describe('Records tab', () => {
  it('saves a vaccination with the dose exactly as typed and no schedule link', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=records');
    const actions = userEvent.setup();

    await actions.click(await screen.findByRole('button', { name: 'Add record' }));
    await actions.type(
      screen.getByLabelText('Name of the procedure or vaccination'),
      'Hepatitis B',
    );
    await actions.type(screen.getByLabelText('Dose / volume'), '0.5');
    await actions.selectOptions(screen.getByLabelText('Unit'), 'ml');
    await actions.type(screen.getByLabelText('Manufacturer'), 'Maker');
    await actions.type(screen.getByLabelText('Doctor / clinic'), 'Clinic 5');
    await actions.click(screen.getByRole('button', { name: 'Save record' }));

    await waitFor(() => {
      expect(sent('POST', /\/health$/)).toHaveLength(1);
    });
    const { body } = sent('POST', /\/health$/)[0] as { body: Record<string, unknown> };
    expect(body).toMatchObject({
      category: 'vaccination',
      name: 'Hepatitis B',
      doseValue: 0.5,
      doseUnit: 'ml',
      manufacturer: 'Maker',
      provider: 'Clinic 5',
    });
    expect(body).not.toHaveProperty('scheduleKey');
    expect(typeof body.occurredAt).toBe('string');
  });

  it('explains what is wrong and sends nothing', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=records');
    const actions = userEvent.setup();

    await actions.click(await screen.findByRole('button', { name: 'Add record' }));
    await actions.type(screen.getByLabelText('Dose / volume'), '2');
    await actions.click(screen.getByRole('button', { name: 'Save record' }));

    expect(await screen.findByText('Enter a name.')).toBeDefined();
    expect(screen.getByText('Choose a unit for the dose.')).toBeDefined();
    expect(sent('POST', /\/health$/)).toHaveLength(0);
  });

  it('lists the history and filters it by category', async () => {
    stubApi({
      records: [
        record('r1', { name: 'BCG' }),
        record('r2', { category: 'lab_test', name: 'Blood count' }),
      ],
    });
    renderPage(<HealthPage />, '/health?tab=records');
    const actions = userEvent.setup();

    expect(await screen.findByText('BCG')).toBeDefined();
    expect(screen.getByText('Blood count')).toBeDefined();

    await actions.click(screen.getByRole('button', { name: 'Lab test' }));
    expect(screen.queryByText('BCG')).toBeNull();
    expect(screen.getByText('Blood count')).toBeDefined();

    await actions.click(screen.getByRole('button', { name: 'Checkup' }));
    expect(screen.getByText('No records match these filters.')).toBeDefined();
    await actions.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('BCG')).toBeDefined();
  });

  it('shows every detail that was recorded', async () => {
    stubApi({
      records: [
        record('r1', {
          name: 'Hepatitis B, birth dose',
          purpose: 'Liver protection',
          doseValue: 0.5,
          doseUnit: 'ml',
          productName: 'Product X',
          manufacturer: 'Maker Y',
          provider: 'Maternity 2',
          nextDueOn: '2026-12-01',
          note: 'No reaction',
        }),
      ],
    });
    renderPage(<HealthPage />, '/health?tab=records');

    expect(await screen.findByText('Dose: 0.5 ml')).toBeDefined();
    expect(screen.getByText('Product: Product X')).toBeDefined();
    expect(screen.getByText('Manufacturer: Maker Y')).toBeDefined();
    expect(screen.getByText('Doctor / clinic: Maternity 2')).toBeDefined();
    expect(screen.getByText('Purpose: Liver protection')).toBeDefined();
    expect(screen.getByText(/Next \/ follow-up: Dec 1, 2026/)).toBeDefined();
    expect(screen.getByText('No reaction')).toBeDefined();
  });

  it('edits a record, sending emptied fields as null', async () => {
    stubApi({ records: [record('r1', { note: 'old note' })] });
    renderPage(<HealthPage />, '/health?tab=records');
    const actions = userEvent.setup();

    await actions.click(await screen.findByRole('button', { name: /Edit Hepatitis B/ }));
    const note = screen.getByLabelText('Notes');
    expect((note as HTMLInputElement).value).toBe('old note');
    await actions.clear(note);
    await actions.click(screen.getByRole('button', { name: 'Save record' }));

    await waitFor(() => {
      expect(sent('PATCH', /\/health\/r1$/)).toHaveLength(1);
    });
    expect(sent('PATCH', /\/health\/r1$/)[0]?.body).toMatchObject({
      name: 'Hepatitis B, birth dose',
      note: null,
      doseValue: null,
    });
  });

  it('asks before deleting and deletes nothing on cancel', async () => {
    stubApi({ records: [record('r1')] });
    renderPage(<HealthPage />, '/health?tab=records');
    const actions = userEvent.setup();

    await actions.click(await screen.findByRole('button', { name: /Delete Hepatitis B/ }));
    const question = screen.getByText('Delete this record?');
    await actions.click(
      within(question.closest('div') as HTMLElement).getByRole('button', { name: 'Keep' }),
    );
    expect(sent('DELETE', /\/health\/r1$/)).toHaveLength(0);

    await actions.click(screen.getByRole('button', { name: /Delete Hepatitis B/ }));
    await actions.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(sent('DELETE', /\/health\/r1$/)).toHaveLength(1);
    });
  });

  it('says plainly that attachments are not supported yet', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=records');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add record' }));
    expect(
      screen.getByText(/Attachments \(photos and documents\) are not supported yet/),
    ).toBeDefined();
  });
});

describe('Vaccinations tab', () => {
  it('compares the history with the Armenian schedule, with progress and statuses', async () => {
    stubApi({
      records: [
        record('r1', { scheduleKey: 'hepb-birth', catalogVersion: IMMUNIZATION_CATALOG_VERSION }),
      ],
    });
    renderPage(<HealthPage />, '/health?tab=vaccinations');

    const total = IMMUNIZATION_SCHEDULE.filter((i) => i.effectiveFrom === undefined).length;
    expect(
      (await screen.findAllByText(new RegExp(`^1 of ${String(total)} doses recorded`))).length,
    ).toBeGreaterThan(0);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');

    // Born 100 days ago: BCG can still be caught up, the 6-week dose is late,
    // the 12-week dose is due now, the 18-week one is ahead.
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Due now').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Upcoming').length).toBeGreaterThan(0);
  });

  it('keeps official and international apart, with sources, date and the disclaimer', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=vaccinations');

    expect(await screen.findByText(/must follow the vaccine’s product information/)).toBeDefined();
    expect(screen.getByText('Additional international recommendations')).toBeDefined();
    expect(screen.getByText(/never counted as overdue/)).toBeDefined();
    expect(screen.getByText(/Catalog version 2026\.1 · last reviewed Nov 13, 2026/)).toBeDefined();
    expect(screen.getByText(/Decision N 58-N of 15 January 2026/)).toBeDefined();
    // Armenian abbreviation comes from the decree, translated names stay English here.
    expect(screen.getAllByText(/HepB/).length).toBeGreaterThan(0);
  });

  it('says there is no verified checkup schedule instead of inventing one', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=vaccinations');
    expect(
      await screen.findByText(/no verified official Armenian reference has been added/),
    ).toBeDefined();
  });

  it('records a dose from the schedule, linking it and stamping the catalog version', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=vaccinations');
    const actions = userEvent.setup();

    await actions.click(
      (
        await screen.findAllByRole('button', { name: /Record BCG \(Ani\), dose 1/ })
      )[0] as HTMLElement,
    );
    const select = screen.getByLabelText('Dose in the Armenian schedule') as HTMLSelectElement;
    expect(select.value).toBe('bcg-1');
    expect(
      (screen.getByLabelText('Name of the procedure or vaccination') as HTMLInputElement).value,
    ).toContain('BCG');
    // The dose is never filled in for the parent.
    expect((screen.getByLabelText('Dose / volume') as HTMLInputElement).value).toBe('');

    await actions.click(screen.getByRole('button', { name: 'Save record' }));
    await waitFor(() => {
      expect(sent('POST', /\/health$/)).toHaveLength(1);
    });
    expect(sent('POST', /\/health$/)[0]?.body).toMatchObject({
      category: 'vaccination',
      scheduleKey: 'bcg-1',
      catalogVersion: IMMUNIZATION_CATALOG_VERSION,
    });
  });

  it('shows what the decree says in the details, including its stated volume', async () => {
    stubApi();
    renderPage(<HealthPage />, '/health?tab=vaccinations');
    expect(
      (await screen.findAllByText(/As stated in the decree: 0\.05 ml, intradermal, left upper arm/))
        .length,
    ).toBeGreaterThan(0);
  });

  it('keeps a record whose dose is no longer in the schedule, as recorded', async () => {
    stubApi({
      records: [
        record('r9', {
          name: 'Old schedule dose',
          scheduleKey: 'retired-dose-9',
          catalogVersion: '1999.1',
        }),
      ],
    });
    renderPage(<HealthPage />, '/health?tab=vaccinations');
    expect(await screen.findByText('Recorded doses not in the current schedule')).toBeDefined();
    expect(screen.getByText(/Old schedule dose/)).toBeDefined();
  });

  it('asks for a birth date instead of guessing one', async () => {
    const { birthDate: _unused, ...withoutBirthDate } = ani();
    stubApi({ babies: [withoutBirthDate as Baby] });
    renderPage(<HealthPage />, '/health?tab=vaccinations');
    expect(
      await screen.findByText(/Add Ani’s birth date to see the vaccination schedule/),
    ).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
