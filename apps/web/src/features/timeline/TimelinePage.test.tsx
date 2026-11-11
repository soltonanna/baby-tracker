import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeEventCursor,
  localDayRange,
  parseEventCursor,
  type Baby,
  type BabyEvent,
  type FamilyWithRole,
  type PublicUser,
} from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext.js';
import { TimelinePage } from './TimelinePage.js';

/**
 * The Timeline screen through its real query layer, against a fake of the
 * family events endpoint that keeps the API's contract: newest first by
 * (startedAt, id), `limit` per page, twin siblings added to a page wherever
 * they sort, `nextCursor` from the page's own last event, and `activeAt` for
 * running sleeps. Only `fetch` is replaced.
 */

const ZONE = 'Asia/Yerevan'; // UTC+4, no daylight saving
const NOW = new Date('2026-11-11T12:00:00.000Z'); // 16:00 in Yerevan
const FAMILY_ID = 'family-1';
const ANI = 'a'.repeat(24);
const NARE = 'b'.repeat(24);

const family: FamilyWithRole = {
  id: FAMILY_ID,
  name: 'Family',
  createdBy: 'user-1',
  role: 'OWNER',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const baby = (id: string, name: string, gender: Baby['gender']): Baby => ({
  id,
  familyId: FAMILY_ID,
  name,
  gender,
  birthDate: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
});

const babies = [baby(ANI, 'Ani', 'FEMALE'), baby(NARE, 'Nare', 'MALE')];

const user: PublicUser = {
  id: 'user-1',
  email: 'parent@example.com',
  displayName: 'Parent',
  locale: 'en',
  timezone: ZONE,
  units: { weight: 'kg', length: 'cm', volume: 'ml' },
  createdAt: '2026-08-01T09:00:00.000Z',
};

/** A Yerevan wall-clock time as an instant: `local('2026-11-10', '22:00')`. */
const local = (date: string, hhmm: string): string => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const { start } = localDayRange(date, ZONE);
  return new Date(start.getTime() + ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000).toISOString();
};

let idCounter = 0;
const event = (
  babyId: string,
  type: BabyEvent['type'],
  startedAt: string,
  overrides: Partial<BabyEvent> = {},
): BabyEvent => {
  idCounter += 1;
  return {
    id: idCounter.toString(16).padStart(24, '0'),
    familyId: FAMILY_ID,
    babyId,
    type,
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const newestFirst = (a: BabyEvent, b: BabyEvent): number =>
  Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The family events endpoint, as the API answers it. */
function familyEvents(store: BabyEvent[], url: URL): Response {
  const params = url.searchParams;
  const babyId = params.get('babyId');
  const types = params.get('types')?.split(',');
  const before = params.get('before');
  const activeAt = params.get('activeAt');
  const limit = Number(params.get('limit') ?? 50);

  const inScope = (candidate: BabyEvent): boolean =>
    (babyId === null || candidate.babyId === babyId) &&
    (types === undefined || types.includes(candidate.type));

  let list = store.filter(inScope).sort(newestFirst);
  if (activeAt !== null) {
    const instant = Date.parse(activeAt);
    list = list.filter(
      (candidate) =>
        Date.parse(candidate.startedAt) < instant &&
        (candidate.endedAt === undefined || Date.parse(candidate.endedAt) > instant),
    );
  }
  if (before !== null) {
    const cursor = parseEventCursor(before);
    if (cursor === null) return json({ error: { code: 'VALIDATION_ERROR' } }, 422);
    list = list.filter((candidate) => {
      const started = Date.parse(candidate.startedAt);
      const bound = cursor.startedAt.getTime();
      return (
        started < bound ||
        (cursor.id !== undefined && started === bound && candidate.id < cursor.id)
      );
    });
  }

  const page = list.slice(0, limit);
  const last = page.at(-1);
  const groups = new Set(page.flatMap((candidate) => candidate.groupId ?? []));
  const siblings =
    babyId === null && activeAt === null
      ? store.filter(
          (candidate) =>
            candidate.groupId !== undefined &&
            groups.has(candidate.groupId) &&
            !page.includes(candidate) &&
            inScope(candidate),
        )
      : [];

  return json({
    events: [...page, ...siblings].sort(newestFirst),
    nextCursor: list.length > limit && last !== undefined ? encodeEventCursor(last) : null,
  });
}

interface Api {
  /** Every family-events read, as parsed URLs, in order. */
  timelineReads: URL[];
  deletes: string[];
}

function stubApi(
  store: BabyEvent[],
  options: { timeline?: (url: URL) => Promise<Response> } = {},
): Api {
  const api: Api = { timelineReads: [], deletes: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://test');
      const method = init?.method ?? 'GET';

      if (url.pathname.endsWith(`/families/${FAMILY_ID}/events`)) {
        api.timelineReads.push(url);
        return options.timeline?.(url) ?? Promise.resolve(familyEvents(store, url));
      }
      const single = /\/babies\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
      if (single !== null && method === 'DELETE') {
        api.deletes.push(single[2] ?? '');
        const index = store.findIndex((candidate) => candidate.id === single[2]);
        if (index !== -1) store.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.pathname.endsWith('/babies')) return Promise.resolve(json({ babies }));
      if (url.pathname.endsWith('/families')) return Promise.resolve(json({ families: [family] }));
      throw new Error(`Unexpected request in test: ${method} ${url.pathname}`);
    }),
  );

  return api;
}

function renderTimeline(): void {
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

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  render(<TimelinePage />, { wrapper: Wrapper });
}

/** The section for one day heading: "Today", "Yesterday" or a date. */
async function daySection(name: string | RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`No section for ${String(name)}`);
  return section;
}

/** The ordinary family: a twin feeding, a sleep across midnight, a note, a nappy. */
function familyDays(): BabyEvent[] {
  const both = { feeding: { kind: 'formula' as const }, amount: 90, unit: 'ml', groupId: 'g1' };
  return [
    event(ANI, 'FEEDING', local('2026-11-11', '10:00'), both),
    event(NARE, 'FEEDING', local('2026-11-11', '10:05'), both),
    event(ANI, 'DIAPER', local('2026-11-11', '09:00'), { details: 'wet' }),
    event(NARE, 'SLEEP', local('2026-11-10', '22:00'), { endedAt: local('2026-11-11', '02:00') }),
    event(ANI, 'NOTE', local('2026-11-10', '12:00'), { details: 'First smile' }),
    event(ANI, 'DIAPER', local('2026-11-09', '08:00'), { details: 'dirty' }),
  ];
}

beforeEach(() => {
  resetSession();
  resetRefreshState();
  idCounter = 0;
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the combined list', () => {
  it('shows every baby’s days newest first, each row marked with its baby', async () => {
    stubApi(familyDays());
    renderTimeline();

    const today = await daySection('Today');
    const yesterday = await daySection('Yesterday');
    const older = await daySection(/November 9/);
    expect(
      today.compareDocumentPosition(yesterday) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      yesterday.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(yesterday).getByText('First smile')).toBeTruthy();
    expect(within(yesterday).getByRole('button', { name: 'Edit Sleep (Nare)' })).toBeTruthy();
    expect(screen.getByText('That is the start of the timeline.')).toBeTruthy();
  });

  it('shows a twin action as one row holding each baby’s own half', async () => {
    stubApi(familyDays());
    renderTimeline();

    const today = await daySection('Today');
    const pair = within(today).getByText('Both babies').closest('li');
    if (pair === null) throw new Error('no combined row');

    expect(within(pair).getByRole('button', { name: 'Edit Feeding (Ani)' })).toBeTruthy();
    expect(within(pair).getByRole('button', { name: 'Edit Feeding (Nare)' })).toBeTruthy();
    // Exactly once on the screen: the pair is not also listed as two rows.
    expect(screen.getAllByRole('button', { name: /^Edit Feeding/ })).toHaveLength(2);
  });

  it('summarises each complete day per baby, with sleep split at midnight', async () => {
    stubApi(familyDays());
    renderTimeline();

    const today = await daySection('Today');
    const summary = await within(today).findByRole('list', { name: 'Day summary' });
    const [ani, nare] = within(summary).getAllByRole('listitem');

    expect(ani?.textContent).toContain('Ani');
    expect(ani?.textContent).toContain('Feedings: 1');
    expect(ani?.textContent).toContain('Sleep: 0m');
    expect(ani?.textContent).toContain('Nappies: 1');
    // 22:00 → 02:00: two hours of it belong to today, two to yesterday.
    expect(nare?.textContent).toContain('Sleep: 2h 0m');
    const yesterday = await daySection('Yesterday');
    expect(
      (await within(yesterday).findByRole('list', { name: 'Day summary' }))?.textContent,
    ).toContain('Sleep: 2h 0m');
  });
});

describe('paging and the daily summary', () => {
  /**
   * 49 notes today and a nappy at 23:00 yesterday fill the first page of 50.
   * Today is then complete — the cursor is before its first instant — but
   * yesterday is not, and Ani's 21:00 → 03:00 sleep is on the unloaded page.
   */
  function crowdedDay(): BabyEvent[] {
    const notes = Array.from({ length: 49 }, (_, index) =>
      event(ANI, 'NOTE', local('2026-11-11', `10:${String(index).padStart(2, '0')}`), {
        details: `note ${index}`,
      }),
    );
    return [
      ...notes,
      event(NARE, 'DIAPER', local('2026-11-10', '23:00'), { details: 'wet' }),
      event(ANI, 'SLEEP', local('2026-11-10', '21:00'), { endedAt: local('2026-11-11', '03:00') }),
      event(ANI, 'NOTE', local('2026-11-10', '08:00'), { details: 'Morning walk' }),
    ];
  }

  it('summarises a complete day from the running-sleep read, before its sleep is loaded', async () => {
    const api = stubApi(crowdedDay());
    renderTimeline();

    const today = await daySection('Today');
    const summary = await within(today).findByRole('list', { name: 'Day summary' });
    // Ani slept from 21:00 yesterday: three hours of it are today's.
    expect(within(summary).getAllByRole('listitem')[0]?.textContent).toContain('Sleep: 3h 0m');

    const activeAt = api.timelineReads.find((read) => read.searchParams.has('activeAt'));
    expect(activeAt?.searchParams.get('activeAt')).toBe(
      localDayRange('2026-11-11', ZONE).start.toISOString(),
    );
    expect(activeAt?.searchParams.get('types')).toBe('SLEEP');

    // Yesterday is cut by the page boundary: no numbers that might be short.
    const yesterday = await daySection('Yesterday');
    expect(
      within(yesterday).getByText(/summary appears once the whole day is loaded/),
    ).toBeTruthy();
  });

  it('loads earlier entries on request, each exactly once, and completes the day', async () => {
    const user = userEvent.setup();
    stubApi(crowdedDay());
    renderTimeline();

    await user.click(await screen.findByRole('button', { name: 'Show earlier' }));

    const yesterday = await daySection('Yesterday');
    expect(await within(yesterday).findByText('Morning walk')).toBeTruthy();
    expect(
      (await within(yesterday).findByRole('list', { name: 'Day summary' }))?.textContent,
    ).toContain('Sleep: 3h 0m');
    expect(screen.getAllByText(/^note \d+$/)).toHaveLength(49);
    expect(await screen.findByText('That is the start of the timeline.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
  });

  it('keeps the list and offers the button again when an earlier page fails', async () => {
    const user = userEvent.setup();
    const store = crowdedDay();
    stubApi(store, {
      timeline: (url) =>
        Promise.resolve(
          url.searchParams.get('before')?.includes('_')
            ? json({ error: { code: 'INTERNAL' } }, 500)
            : familyEvents(store, url),
        ),
    });
    renderTimeline();

    await user.click(await screen.findByRole('button', { name: 'Show earlier' }));

    expect(await screen.findByText('Could not load earlier entries. Try again.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Show earlier' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('filters', () => {
  it('narrows to one baby: no markers, no combined row, and the API is asked for that baby', async () => {
    const user = userEvent.setup();
    const api = stubApi(familyDays());
    renderTimeline();
    await daySection('Today');

    await user.click(screen.getByRole('radio', { name: 'Ani' }));

    await waitFor(() => {
      expect(api.timelineReads.at(-1)?.searchParams.get('babyId')).toBe(ANI);
    });
    const today = await daySection('Today');
    await waitFor(() => {
      expect(within(today).queryByText('Both babies')).toBeNull();
    });
    expect(within(today).getByRole('button', { name: 'Edit Feeding' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Nare/ })).toBeNull();
  });

  it('narrows to the pressed types, and summarises only those', async () => {
    const user = userEvent.setup();
    const api = stubApi(familyDays());
    renderTimeline();
    await daySection('Today');

    await user.click(screen.getByRole('button', { name: 'Sleep', pressed: false }));

    await waitFor(() => {
      expect(
        api.timelineReads.some(
          (read) =>
            read.searchParams.get('types') === 'SLEEP' && !read.searchParams.has('activeAt'),
        ),
      ).toBe(true);
    });
    const yesterday = await daySection('Yesterday');
    await waitFor(() => {
      expect(within(yesterday).queryByText('First smile')).toBeNull();
    });
    const summary = await within(yesterday).findByRole('list', { name: 'Day summary' });
    expect(summary?.textContent).toContain('Sleep: 2h 0m');
    expect(summary.textContent).not.toContain('Feedings');
  });

  it('says so when nothing matches the filters', async () => {
    const user = userEvent.setup();
    stubApi([event(ANI, 'NOTE', local('2026-11-11', '08:00'), { details: 'x' })]);
    renderTimeline();
    await daySection('Today');

    await user.click(screen.getByRole('button', { name: 'Nappy', pressed: false }));

    expect(await screen.findByText('Nothing matches these filters.')).toBeTruthy();
  });

  it('jumps to a date, and goes back to the latest', async () => {
    const user = userEvent.setup();
    const api = stubApi(familyDays());
    renderTimeline();
    await daySection('Today');

    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2026-11-09' } });

    await waitFor(() => {
      expect(api.timelineReads.at(-1)?.searchParams.get('before')).toBe(
        localDayRange('2026-11-09', ZONE).end.toISOString(),
      );
    });
    expect(await daySection(/November 9/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to latest' }));
    expect(await daySection('Today')).toBeTruthy();
  });
});

describe('states', () => {
  it('says the timeline is empty when nothing has been recorded', async () => {
    stubApi([]);
    renderTimeline();
    expect(await screen.findByText(/No entries yet/)).toBeTruthy();
  });

  it('reports a failed first page and retries it', async () => {
    const user = userEvent.setup();
    const store = familyDays();
    let fail = true;
    stubApi(store, {
      timeline: (url) =>
        Promise.resolve(
          fail ? json({ error: { code: 'INTERNAL' } }, 500) : familyEvents(store, url),
        ),
    });
    renderTimeline();

    expect(await screen.findByText('Could not load the timeline.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await daySection('Today')).toBeTruthy();
  });
});

describe('editing', () => {
  it('opens the edit form in place of the row, and closes it on cancel', async () => {
    const user = userEvent.setup();
    stubApi(familyDays());
    renderTimeline();
    const yesterday = await daySection('Yesterday');

    await user.click(within(yesterday).getByRole('button', { name: 'Edit Sleep (Nare)' }));

    expect(within(yesterday).getByRole('heading', { name: 'Edit sleep' })).toBeTruthy();
    await user.click(within(yesterday).getByRole('button', { name: 'Cancel' }));
    expect(within(yesterday).queryByRole('heading', { name: 'Edit sleep' })).toBeNull();
  });

  it('deletes one baby’s half of a pair and refreshes the timeline', async () => {
    const user = userEvent.setup();
    const store = familyDays();
    const api = stubApi(store);
    renderTimeline();
    const today = await daySection('Today');

    await user.click(within(today).getByRole('button', { name: 'Delete Feeding (Nare)' }));
    await user.click(within(today).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(within(today).queryByRole('button', { name: 'Edit Feeding (Nare)' })).toBeNull();
    });
    expect(api.deletes).toHaveLength(1);
    // The remaining half is an ordinary row again.
    expect(within(today).queryByText('Both babies')).toBeNull();
    expect(within(today).getByRole('button', { name: 'Edit Feeding (Ani)' })).toBeTruthy();
  });
});
