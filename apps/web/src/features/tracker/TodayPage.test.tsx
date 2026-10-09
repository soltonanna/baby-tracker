import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baby, BabyEvent, FamilyWithRole, PublicUser } from '@baby-tracker/shared';
import { addLocalDays, localDayRange, toLocalDate, volumeToMl } from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext.js';
import { TodayPage } from './TodayPage.js';

/**
 * An element's text without its decorative parts — what a screen reader says.
 * A baby tab carries an `aria-hidden` initial avatar beside the name.
 */
function spokenText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => {
    hidden.remove();
  });
  return copy.textContent;
}

/**
 * These tests exercise the Today screen through its real query layer: the only
 * thing replaced is `fetch`. That keeps the assertions about what a parent
 * sees, and still proves that switching babies actually re-requests events.
 */

const FAMILY_ID = 'family-1';
const ANI_ID = 'baby-ani';
const NARE_ID = 'baby-nare';

const family: FamilyWithRole = {
  id: FAMILY_ID,
  name: 'Sultanova',
  createdBy: 'user-1',
  role: 'OWNER',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const baby = (id: string, name: string): Baby => ({
  id,
  familyId: FAMILY_ID,
  name,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
});

const babies: Baby[] = [baby(ANI_ID, 'Ani'), baby(NARE_ID, 'Nare')];

const event = (id: string, babyId: string, overrides: Partial<BabyEvent> = {}): BabyEvent => ({
  id,
  familyId: FAMILY_ID,
  babyId,
  type: 'FEEDING',
  startedAt: '2026-09-08T07:30:00.000Z',
  createdAt: '2026-09-08T07:30:00.000Z',
  updatedAt: '2026-09-08T07:30:00.000Z',
  ...overrides,
});

const aniEvents: BabyEvent[] = [
  event('event-ani-1', ANI_ID, { amount: 120, unit: 'ml', details: 'Took the whole bottle' }),
  event('event-ani-2', ANI_ID, {
    type: 'SLEEP',
    startedAt: '2026-09-08T05:00:00.000Z',
    endedAt: '2026-09-08T06:15:00.000Z',
  }),
];

/** 23:00 to 01:00: one session that crosses midnight, per decision D5. */
const overnightSleep: BabyEvent = event('event-ani-3', ANI_ID, {
  type: 'SLEEP',
  startedAt: '2026-09-08T23:00:00.000Z',
  endedAt: '2026-09-09T01:00:00.000Z',
});

const nareEvents: BabyEvent[] = [event('event-nare-1', NARE_ID, { type: 'DIAPER' })];

/**
 * What the API answers a both-babies create with: the two ordinary events it
 * wrote, and the id the server generated to link them. One per baby, never one
 * document naming two babies (decision D2).
 */
const bothEvent = (overrides: Partial<BabyEvent> = {}, groupId = 'group-1') => ({
  groupId,
  events: [
    event('event-both-ani', ANI_ID, { ...overrides, groupId }),
    event('event-both-nare', NARE_ID, { ...overrides, groupId }),
  ],
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const apiError = (status: number, code: string): Response =>
  json({ error: { code, message: code } }, status);

/**
 * An events route that answers the way the API does: the events of that baby
 * whose *start* falls in the requested half-open range, newest first. Without a
 * range it answers with all of them, which is the endpoint's older behaviour.
 *
 * Written once here so that every day-scoping test asserts against one fake
 * with the same rule, rather than each hand-picking the events it expects.
 */
const dayScoped =
  (all: BabyEvent[]) =>
  (babyId: string, range: RequestedRange): Promise<Response> => {
    const mine = all.filter((candidate) => candidate.babyId === babyId);
    const within =
      range.from === null || range.to === null
        ? mine
        : mine.filter((candidate) => {
            const started = Date.parse(candidate.startedAt);
            return started >= Date.parse(range.from ?? '') && started < Date.parse(range.to ?? '');
          });

    return Promise.resolve(
      json({
        events: [...within].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
      }),
    );
  };

/** Never settles — used to hold a screen in its pending state. */
const never = (): Promise<Response> => new Promise<Response>(() => {});

/** The day range a list request carried, if any. */
interface RequestedRange {
  from: string | null;
  to: string | null;
}

interface Routes {
  families?: () => Promise<Response>;
  /** POST to the same path as `families`. */
  createFamily?: () => Promise<Response>;
  babies?: () => Promise<Response>;
  /** POST to the same path as `babies`. */
  createBaby?: () => Promise<Response>;
  events?: (babyId: string, range: RequestedRange) => Promise<Response>;
  /** POST to the same path as `events`. */
  createEvent?: (babyId: string) => Promise<Response>;
  /** POST to the family's event-groups path: one entry for both babies. */
  createEventGroup?: () => Promise<Response>;
  /** PATCH on one event. */
  updateEvent?: (babyId: string, eventId: string) => Promise<Response>;
  /** DELETE on one event. */
  deleteEvent?: (babyId: string, eventId: string) => Promise<Response>;
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Routes by URL rather than by call order, so a test never depends on the order
 * TanStack Query happens to fire its requests in.
 */
function stubApi(routes: Routes): void {
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    // Routed on the path alone: the events list now carries a day range in its
    // query string, and every route below is about which resource is asked for.
    // The range itself is handed to the events route, so a test can answer the
    // way the API does — with the events that started inside it.
    const requested = new URL(String(input), 'http://localhost');
    const url = requested.pathname;
    const range: RequestedRange = {
      from: requested.searchParams.get('from'),
      to: requested.searchParams.get('to'),
    };
    const method = init?.method ?? 'GET';

    const oneEvent = /\/families\/[^/]+\/babies\/([^/]+)\/events\/([^/]+)$/.exec(url);
    if (oneEvent) {
      const babyId = oneEvent[1] ?? '';
      const eventId = oneEvent[2] ?? '';
      if (method === 'PATCH') {
        return (
          routes.updateEvent ??
          ((id: string, patchedId: string) =>
            Promise.resolve(json({ event: event(patchedId, id) })))
        )(babyId, eventId);
      }
      if (method === 'DELETE') {
        // 204 with no body, exactly as the API answers it.
        return (routes.deleteEvent ?? (() => Promise.resolve(new Response(null, { status: 204 }))))(
          babyId,
          eventId,
        );
      }
    }

    const events = /\/families\/[^/]+\/babies\/([^/]+)\/events$/.exec(url);
    if (events) {
      const babyId = events[1] ?? '';
      if (method === 'POST') {
        return (
          routes.createEvent ??
          ((id: string) => Promise.resolve(json({ event: event('event-new', id) }, 201)))
        )(babyId);
      }
      return (routes.events ?? (() => Promise.resolve(json({ events: [] }))))(babyId, range);
    }

    if (url.endsWith('/event-groups') && method === 'POST') {
      return (
        routes.createEventGroup ?? (() => Promise.resolve(json({ group: bothEvent() }, 201)))
      )();
    }

    if (url.endsWith('/babies')) {
      if (method === 'POST') {
        return (
          routes.createBaby ?? (() => Promise.resolve(json({ baby: baby('baby-new', 'Ani') }, 201)))
        )();
      }
      return (routes.babies ?? (() => Promise.resolve(json({ babies }))))();
    }

    if (url.endsWith('/families')) {
      if (method === 'POST') {
        return (routes.createFamily ?? (() => Promise.resolve(json({ family }, 201))))();
      }
      return (routes.families ?? (() => Promise.resolve(json({ families: [family] }))))();
    }

    throw new Error(`Unexpected request in test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
}

/**
 * Event *list* reads so far, in order: which baby, and which day range was asked
 * for.
 *
 * The feeding summary also reads the previous day, once per baby and day, to
 * find when yesterday's last feeding began. That read carries an explicit
 * `limit` and the list's does not, so it is left out here: these assertions are
 * about the day the list shows. `previousDayReads()` answers for the other one.
 */
const requestedEventReads = (): { babyId: string; from: string | null; to: string | null }[] =>
  allEventReads().filter((read) => read.limit === null);

/** The summary's previous-day reads, in order. */
const previousDayReads = (): { babyId: string; from: string | null; to: string | null }[] =>
  allEventReads().filter((read) => read.limit !== null);

const allEventReads = (): {
  babyId: string;
  from: string | null;
  to: string | null;
  limit: string | null;
}[] =>
  fetchMock.mock.calls
    .filter((call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET')
    .map((call) => {
      const url = new URL(String(call[0]), 'http://localhost');
      const match = /\/babies\/([^/]+)\/events$/.exec(url.pathname);
      return match === null
        ? null
        : {
            babyId: match[1] ?? '',
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to'),
            limit: url.searchParams.get('limit'),
          };
    })
    .filter(
      (
        read,
      ): read is { babyId: string; from: string | null; to: string | null; limit: string | null } =>
        read !== null,
    );

/** Event *reads* so far, in order, as baby ids. */
const requestedEventBabyIds = (): string[] => requestedEventReads().map((read) => read.babyId);

/** The bodies of the family creations made so far, parsed. */
const createdFamilyBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/families'),
    )
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

/** The bodies of the baby creations made so far, parsed. */
const createdBabyBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/babies'),
    )
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

/** The bodies of the event creations made so far, parsed. */
const createdEventBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

/** The both-babies creations made so far, parsed. */
const createdGroupBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/event-groups'),
    )
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

/** The URLs the both-babies creations were sent to. */
const createdGroupUrls = (): string[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/event-groups'),
    )
    .map((call) => String(call[0]));

/** The event creations sent to one baby's own endpoint, with where each went. */
const createdSingleEvents = (): { url: string; body: unknown }[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        /\/babies\/[^/]+\/events$/.test(String(call[0])),
    )
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit).body)) as unknown,
    }));

/** The edits made so far: where each one was sent, and what it carried. */
const patchedEvents = (): { url: string; body: unknown }[] =>
  fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit).body)) as unknown,
    }));

/** The URLs of the deletions made so far. */
const deletedEventUrls = (): string[] =>
  fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE')
    .map((call) => String(call[0]));

/**
 * The instant a `HH:MM` shown in an entry form stands for, in this machine's zone.
 * `dayOffset` moves it whole local days — 1 is the following day, which is where
 * a sleep that crosses midnight ends.
 */
function startedAtFor(time: string, dayOffset = 0): string {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date.toISOString();
}

/**
 * Sets an `<input type="time">`.
 *
 * `userEvent.type` would enter a time one keystroke at a time, and every
 * intermediate value is an invalid time that jsdom discards. A change event is
 * what the browser itself dispatches once a time is picked.
 */
function setTime(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

/** The zone the machine running the suite is in — what a browser would report. */
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const signedInUser = (timezone: string): PublicUser => ({
  id: 'user-1',
  email: 'parent@example.com',
  displayName: 'Parent',
  locale: 'en',
  timezone,
  units: { weight: 'kg', length: 'cm', volume: 'ml' },
  createdAt: '2026-08-01T09:00:00.000Z',
});

/**
 * Today, in a zone, as the two instants the page asks the API for.
 * Built from the shared helpers rather than restated, so the expectation is the
 * contract and not a second implementation of it.
 */
function expectedDayRange(timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const { start, end } = localDayRange(toLocalDate(now, timeZone), timeZone);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Renders the page as it is rendered in the app: inside an authenticated
 * session, because Today reads the signed-in user's time zone to know which
 * calendar day it is showing. The default is this machine's own zone, which is
 * also what registration stores for a real account.
 */
function renderToday(options: { timezone?: string } = {}): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries: an error must surface as an error, not as a long wait.
      queries: { retry: false, staleTime: 0 },
    },
  });

  const auth: AuthContextValue = {
    status: 'authenticated',
    user: signedInUser(options.timezone ?? BROWSER_ZONE),
    register: () => Promise.resolve(),
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  }

  render(<TodayPage />, { wrapper: Wrapper });
}

/** The events card, once it is on screen — everything above it has resolved. */
async function eventsCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Today' });
  const section = heading.closest('section');
  if (section === null) {
    throw new Error('The events card heading is not inside a section');
  }
  return section;
}

/** The event rows on screen, once everything above the card has resolved. */
async function eventRows(): Promise<HTMLElement[]> {
  const card = await eventsCard();
  return within(card).findAllByRole('listitem');
}

/** The first event row — the only one, in most of the tests below. */
async function firstEventRow(): Promise<HTMLElement> {
  const [row] = await eventRows();
  if (row === undefined) {
    throw new Error('No event rows on screen');
  }
  return row;
}

beforeEach(() => {
  resetSession();
  resetRefreshState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('babies', () => {
  it('loads the babies of the caller’s family and offers one tab each', async () => {
    stubApi({});
    renderToday();

    const tabs = await screen.findAllByRole('tab');

    expect(tabs.map(spokenText)).toEqual(['Ani', 'Nare']);
  });

  it('selects the first baby automatically', async () => {
    stubApi({});
    renderToday();

    expect(await screen.findByRole('tab', { name: 'Ani', selected: true })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Nare' }).getAttribute('aria-selected')).toBe('false');
  });
});

describe('events', () => {
  it('loads the events of the selected baby only', async () => {
    stubApi({
      events: (babyId) =>
        Promise.resolve(json({ events: babyId === ANI_ID ? aniEvents : nareEvents })),
    });
    renderToday();

    await screen.findByText('Took the whole bottle');

    expect(requestedEventBabyIds()).toEqual([ANI_ID]);
  });

  it('renders type, time, amount and details for each event', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: aniEvents })) });
    renderToday();

    const card = await eventsCard();
    const items = await within(card).findAllByRole('listitem');
    expect(items).toHaveLength(2);

    const feeding = items[0] as HTMLElement;
    expect(within(feeding).getByText('Feeding')).toBeDefined();
    expect(within(feeding).getByText('120 ml')).toBeDefined();
    expect(within(feeding).getByText('Took the whole bottle')).toBeDefined();
    // Asserted through the machine-readable attribute, so the test does not
    // depend on the time zone the suite happens to run in.
    expect(feeding.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-09-08T07:30:00.000Z',
    );

    const sleep = items[1] as HTMLElement;
    expect(within(sleep).getByText('Sleep')).toBeDefined();
    expect(within(sleep).queryByText(/ml/)).toBeNull();
  });

  it('renders a sleep event with the duration derived from its start and end', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: aniEvents })) });
    renderToday();

    const card = await eventsCard();
    const items = await within(card).findAllByRole('listitem');

    // 05:00 to 06:15 is an hour and a quarter, and the list says so rather than
    // leaving the parent to subtract two times.
    const sleep = items[1] as HTMLElement;
    expect(within(sleep).getByText('Sleep')).toBeDefined();
    expect(within(sleep).getByText('1h 15m')).toBeDefined();
  });

  it('renders the duration of a sleep that crossed midnight', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [overnightSleep] })) });
    renderToday();

    const card = await eventsCard();
    const item = (await within(card).findAllByRole('listitem'))[0] as HTMLElement;

    // The two instants are two hours apart across a date boundary, and the
    // duration is derived from them rather than from the clock times.
    expect(within(item).getByText('Sleep')).toBeDefined();
    expect(within(item).getByText('2h 0m')).toBeDefined();
  });

  it('loads the other baby’s events when the tab is switched', async () => {
    stubApi({
      events: (babyId) =>
        Promise.resolve(json({ events: babyId === ANI_ID ? aniEvents : nareEvents })),
    });
    renderToday();

    await screen.findByText('Took the whole bottle');

    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));

    await screen.findByText('Nappy');
    expect(screen.queryByText('Took the whole bottle')).toBeNull();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, NARE_ID]);
  });
});

describe('today’s day scope', () => {
  /** An event of Ani's at an instant, whatever kind — the day is what is tested. */
  const at = (id: string, startedAt: string, overrides: Partial<BabyEvent> = {}): BabyEvent =>
    event(id, ANI_ID, { type: 'NOTE', startedAt, details: id, ...overrides });

  it('asks for the current local calendar day of the selected baby', async () => {
    stubApi({ events: dayScoped([at('today-noon', startedAtFor('12:00'))]) });
    renderToday();

    await screen.findByText('today-noon');

    const reads = requestedEventReads();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.babyId).toBe(ANI_ID);
    // The exact boundaries the shared calendar helpers give for today — not a
    // 24-hour window, and not the UTC day.
    expect({ from: reads[0]?.from, to: reads[0]?.to }).toEqual(expectedDayRange(BROWSER_ZONE));
  });

  it('reads the day in the signed-in user’s time zone', async () => {
    // A zone that is nowhere near the machine running the suite, so the range
    // can only be right if it came from the user rather than from the browser.
    const zone = 'Pacific/Kiritimati';
    stubApi({ events: dayScoped([]) });
    renderToday({ timezone: zone });

    await screen.findByText('Nothing recorded yet.');

    const [read] = requestedEventReads();
    expect({ from: read?.from, to: read?.to }).toEqual(expectedDayRange(zone));
  });

  it('falls back to the browser’s zone when the stored one is not a real zone', async () => {
    stubApi({ events: dayScoped([]) });
    renderToday({ timezone: 'Middle/Earth' });

    await screen.findByText('Nothing recorded yet.');

    const [read] = requestedEventReads();
    expect({ from: read?.from, to: read?.to }).toEqual(expectedDayRange(BROWSER_ZONE));
  });

  it('shows today’s events and neither yesterday’s nor tomorrow’s', async () => {
    stubApi({
      events: dayScoped([
        at('yesterday-evening', startedAtFor('19:00', -1)),
        at('today-morning', startedAtFor('08:00')),
        at('today-evening', startedAtFor('21:00')),
        at('tomorrow-morning', startedAtFor('08:00', 1)),
      ]),
    });
    renderToday();

    const card = await eventsCard();
    await within(card).findByText('today-morning');

    // Newest first, as before, and only the current day.
    const rows = await eventRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('today-evening')).toBeDefined();
    expect(within(rows[1] as HTMLElement).getByText('today-morning')).toBeDefined();
    expect(screen.queryByText('yesterday-evening')).toBeNull();
    expect(screen.queryByText('tomorrow-morning')).toBeNull();
  });

  it('includes an event at the first instant of the day and excludes one at the next', async () => {
    const { from, to } = expectedDayRange(BROWSER_ZONE);
    stubApi({ events: dayScoped([at('at-midnight', from), at('at-next-midnight', to)]) });
    renderToday();

    const card = await eventsCard();
    await within(card).findByText('at-midnight');

    // Half-open [from, to): midnight belongs to the day that begins, not to the
    // one that ends, so consecutive days neither lose an event nor repeat one.
    expect(await eventRows()).toHaveLength(1);
    expect(screen.queryByText('at-next-midnight')).toBeNull();
  });

  it('shows the existing empty state when nothing was recorded today', async () => {
    stubApi({ events: dayScoped([at('yesterday-only', startedAtFor('12:00', -1))]) });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();
    expect(within(card).queryByRole('listitem')).toBeNull();
  });

  it('re-scopes to the other twin’s current day when the tab is switched', async () => {
    stubApi({
      events: dayScoped([
        at('ani-today', startedAtFor('09:00')),
        event('nare-today', NARE_ID, {
          type: 'DIAPER',
          startedAt: startedAtFor('10:00'),
          details: 'wet',
        }),
        event('nare-yesterday', NARE_ID, {
          type: 'DIAPER',
          startedAt: startedAtFor('10:00', -1),
          details: 'dry',
        }),
      ]),
    });
    renderToday();

    await screen.findByText('ani-today');
    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));
    await screen.findByText('Wet');

    // One request per baby, each for that baby and for the same current day —
    // so the two caches cannot collide and neither reads the other's events.
    const reads = requestedEventReads();
    expect(reads.map((read) => read.babyId)).toEqual([ANI_ID, NARE_ID]);
    expect(new Set(reads.map((read) => `${read.from ?? ''}/${read.to ?? ''}`)).size).toBe(1);
    expect(screen.queryByText('ani-today')).toBeNull();
    // Yesterday's nappy stays out of the switched-to day as well.
    expect(screen.queryByText('Dry')).toBeNull();
  });

  it('shows an event created today once the list is refetched', async () => {
    const created: BabyEvent[] = [];
    stubApi({
      events: (babyId, range) => dayScoped(created)(babyId, range),
      createEvent: (babyId) => {
        const saved = event('event-new', babyId, {
          type: 'NOTE',
          startedAt: startedAtFor('12:00'),
          details: 'Slept well',
        });
        created.push(saved);
        return Promise.resolve(json({ event: saved }, 201));
      },
    });
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));
    await userEvent.type(screen.getByLabelText('Note'), 'Slept well');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The invalidation after a save refreshes the day that is on screen, even
    // though the mutation does not know which day that is.
    expect(await screen.findByText('Slept well')).toBeDefined();
    expect(requestedEventReads().length).toBeGreaterThan(1);
    for (const read of requestedEventReads()) {
      expect({ from: read.from, to: read.to }).toEqual(expectedDayRange(BROWSER_ZONE));
    }
  });

  it('keeps the day scope when the list is refreshed after a delete', async () => {
    const remaining: BabyEvent[] = [at('to-delete', startedAtFor('09:00'))];
    stubApi({
      events: (babyId, range) => dayScoped(remaining)(babyId, range),
      deleteEvent: () => {
        remaining.length = 0;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    renderToday();

    const row = await firstEventRow();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete Note' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('to-delete')).toBeNull();
    });
    for (const read of requestedEventReads()) {
      expect({ from: read.from, to: read.to }).toEqual(expectedDayRange(BROWSER_ZONE));
    }
  });

  describe('a sleep that crosses midnight (decision D5)', () => {
    /** 23:00 yesterday to 01:00 today: one session, belonging to yesterday. */
    const overnight: BabyEvent = event('overnight', ANI_ID, {
      type: 'SLEEP',
      startedAt: startedAtFor('23:00', -1),
      endedAt: startedAtFor('01:00'),
    });

    it('is not in today’s list, even though it ended today', async () => {
      stubApi({ events: dayScoped([overnight, at('today-morning', startedAtFor('08:00'))]) });
      renderToday();

      const card = await eventsCard();
      await within(card).findByText('today-morning');

      expect(await eventRows()).toHaveLength(1);
      expect(within(card).queryByText('Sleep')).toBeNull();
    });

    it('belongs to the day it started on, and is not duplicated onto today', () => {
      const today = toLocalDate(new Date(), BROWSER_ZONE);
      const yesterday = localDayRange(addLocalDays(today, -1), BROWSER_ZONE);
      const current = localDayRange(today, BROWSER_ZONE);
      const started = Date.parse(overnight.startedAt);

      expect(started).toBeGreaterThanOrEqual(yesterday.start.getTime());
      expect(started).toBeLessThan(yesterday.end.getTime());
      expect(started).toBeLessThan(current.start.getTime());
    });

    it('is shown with its stored times and its real duration when its day is listed', async () => {
      // Yesterday's list, answered by the same rule the API follows.
      stubApi({
        events: (babyId) =>
          dayScoped([overnight])(babyId, {
            from: localDayRange(
              addLocalDays(toLocalDate(new Date(), BROWSER_ZONE), -1),
              BROWSER_ZONE,
            ).start.toISOString(),
            to: localDayRange(
              addLocalDays(toLocalDate(new Date(), BROWSER_ZONE), -1),
              BROWSER_ZONE,
            ).end.toISOString(),
          }),
      });
      renderToday();

      const row = await firstEventRow();
      expect(within(row).getByText('Sleep')).toBeDefined();
      expect(within(row).getByText('2h 0m')).toBeDefined();
      expect(row.querySelector('time')?.getAttribute('datetime')).toBe(overnight.startedAt);
      // Nothing was rewritten to make it fit a day.
      expect(patchedEvents()).toEqual([]);
      expect(overnight.endedAt).toBe(startedAtFor('01:00'));
    });
  });
});

describe('loading, empty and error states', () => {
  it('shows a loading state while the family and babies are still arriving', () => {
    stubApi({ families: never });
    renderToday();

    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows a loading state in the card while the events are still arriving', async () => {
    stubApi({ events: never });
    renderToday();

    await screen.findByRole('tab', { name: 'Ani' });

    const card = await eventsCard();
    expect(await within(card).findByText('Loading events…')).toBeDefined();
  });

  it('shows an empty state when the selected baby has no events', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [] })) });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();
    expect(within(card).queryByRole('listitem')).toBeNull();
  });

  it('shows an error state when the events request fails', async () => {
    stubApi({ events: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Could not load events. Please try again.')).toBeDefined();
  });

  it('shows an error state when the family request fails', async () => {
    stubApi({ families: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    expect(await screen.findByText('Could not load your family. Please try again.')).toBeDefined();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('adding a note', () => {
  /** Opens the note form for the baby selected by default, and returns its fields. */
  async function openNoteForm(): Promise<{ time: HTMLInputElement; details: HTMLTextAreaElement }> {
    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));

    return {
      time: await screen.findByLabelText('Time'),
      details: screen.getByLabelText('Note'),
    };
  }

  it('opens the note form when the Add note action is used', async () => {
    stubApi({});
    renderToday();

    expect(screen.queryByLabelText('Note')).toBeNull();

    const { time, details } = await openNoteForm();

    expect(screen.getByRole('heading', { name: 'New note' })).toBeDefined();
    // Defaulted to the current local time rather than left empty.
    expect(time.value).toMatch(/^\d{2}:\d{2}$/);
    expect(details.value).toBe('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('requires note text before anything is sent', async () => {
    stubApi({});
    renderToday();

    await openNoteForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please write a note.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
    // Still open, so the parent can simply type.
    expect(screen.getByLabelText('Note')).toBeDefined();
  });

  it('sends a NOTE event for the selected baby', async () => {
    stubApi({});
    renderToday();

    const { time, details } = await openNoteForm();
    const chosenTime = time.value;

    await userEvent.type(details, 'Smiled at the window');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'NOTE',
          startedAt: startedAtFor(chosenTime),
          details: 'Smiled at the window',
        },
      ]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${ANI_ID}/events`);
  });

  it('closes the form and reloads the events once the note is saved', async () => {
    const note = event('event-note', ANI_ID, { type: 'NOTE', details: 'Smiled at the window' });
    let saved = false;

    stubApi({
      events: () => Promise.resolve(json({ events: saved ? [note] : [] })),
      createEvent: (babyId) => {
        saved = true;
        return Promise.resolve(json({ event: event('event-note', babyId) }, 201));
      },
    });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();

    const { details } = await openNoteForm();
    await userEvent.type(details, 'Smiled at the window');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The new note is on screen, and the form is gone.
    expect(await screen.findByText('Smiled at the window')).toBeDefined();
    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeDefined();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
  });

  it('closes the form without sending anything when cancelled', async () => {
    stubApi({});
    renderToday();

    const { details } = await openNoteForm();
    await userEvent.type(details, 'Never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(createdEventBodies()).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeDefined();
  });

  it('reports a failed save and keeps what was typed', async () => {
    stubApi({ createEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    const { details } = await openNoteForm();
    await userEvent.type(details, 'Smiled at the window');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not save the note. Please try again.',
    );
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe(
      'Smiled at the window',
    );
  });
});

describe('adding a feeding', () => {
  /** Opens the feeding form for the baby selected by default, and returns its fields. */
  async function openFeedingForm(): Promise<{
    time: HTMLInputElement;
    amount: HTMLInputElement;
    unit: HTMLSelectElement;
  }> {
    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));
    // A new feeding opens on Breast, which has no amount; these tests are about
    // a bottle, so they choose one first. Breastfeeding has its own describe.
    await userEvent.click(await screen.findByRole('radio', { name: 'Formula' }));

    return {
      time: await screen.findByLabelText('Time'),
      amount: screen.getByLabelText('Amount'),
      unit: screen.getByLabelText('Unit'),
    };
  }

  it('opens the feeding form when the Add feeding action is used', async () => {
    stubApi({});
    renderToday();

    // The action is offered next to the note one, and neither form is open yet.
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeDefined();
    expect(screen.queryByLabelText('Amount')).toBeNull();

    const { time, amount, unit } = await openFeedingForm();

    expect(screen.getByRole('heading', { name: 'New feeding' })).toBeDefined();
    // Defaulted to the current local time rather than left empty.
    expect(time.value).toMatch(/^\d{2}:\d{2}$/);
    expect(amount.value).toBe('');
    expect(unit.value).toBe('ml');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    // The note form is a separate action, not this one.
    expect(screen.queryByLabelText('Note')).toBeNull();
  });

  it('requires an amount before anything is sent', async () => {
    stubApi({});
    renderToday();

    await openFeedingForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter an amount.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
    // Still open, so the parent can simply type.
    expect(screen.getByLabelText('Amount')).toBeDefined();
  });

  it('rejects a negative amount without sending anything', async () => {
    stubApi({});
    renderToday();

    const { amount } = await openFeedingForm();
    await userEvent.type(amount, '-5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter a valid amount.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });

  it('sends a FEEDING event for the selected baby, in millilitres', async () => {
    stubApi({});
    renderToday();

    const { time, amount } = await openFeedingForm();
    const chosenTime = time.value;

    await userEvent.type(amount, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'FEEDING',
          startedAt: startedAtFor(chosenTime),
          amount: 120,
          unit: 'ml',
          feeding: { kind: 'formula' },
        },
      ]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${ANI_ID}/events`);
  });

  it('converts an amount entered in ounces to canonical millilitres', async () => {
    stubApi({});
    renderToday();

    const { amount, unit } = await openFeedingForm();
    await userEvent.selectOptions(unit, 'oz');
    await userEvent.type(amount, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toHaveLength(1);
    });
    // 4 US fl oz is 118.29… ml; the shared conversion rounds canonical ml whole.
    // Asserted as a literal rather than by calling the converter, so a change to
    // the conversion is caught here instead of cancelling itself out.
    expect(createdEventBodies()[0]).toMatchObject({
      type: 'FEEDING',
      amount: 118,
      unit: 'ml',
    });
  });

  it('keeps showing the unit the parent picked while they are editing', async () => {
    stubApi({});
    renderToday();

    const { amount, unit } = await openFeedingForm();
    expect(unit.value).toBe('ml');

    await userEvent.selectOptions(unit, 'oz');
    expect(unit.value).toBe('oz');

    // Still ounces once there is a value in the field: converting to millilitres
    // happens on submit, not under the parent while they type.
    await userEvent.type(amount, '4');
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('oz');
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('4');
  });

  it('posts to the baby that is selected, not the first one', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('tab', { name: 'Nare' }));

    const { amount } = await openFeedingForm();
    await userEvent.type(amount, '80');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toHaveLength(1);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${NARE_ID}/events`);
  });

  it('closes the form and reloads the events once the feeding is saved', async () => {
    const feeding = event('event-feeding', ANI_ID, { type: 'FEEDING', amount: 120, unit: 'ml' });
    let saved = false;

    stubApi({
      events: () => Promise.resolve(json({ events: saved ? [feeding] : [] })),
      createEvent: (babyId) => {
        saved = true;
        return Promise.resolve(json({ event: event('event-feeding', babyId) }, 201));
      },
    });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();

    const { amount } = await openFeedingForm();
    await userEvent.type(amount, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The new feeding is on screen, and the form is gone.
    expect(await screen.findByText('120 ml')).toBeDefined();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
  });

  it('closes the form without sending anything when cancelled', async () => {
    stubApi({});
    renderToday();

    const { amount } = await openFeedingForm();
    await userEvent.type(amount, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(createdEventBodies()).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
  });

  it('reports a failed save and keeps what was entered', async () => {
    stubApi({ createEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    const { amount, unit } = await openFeedingForm();
    await userEvent.selectOptions(unit, 'oz');
    await userEvent.type(amount, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not save the feeding. Please try again.',
    );
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('oz');
  });

  it('closes an unfinished feeding form when the baby is switched', async () => {
    stubApi({});
    renderToday();

    const { amount } = await openFeedingForm();
    await userEvent.type(amount, '120');

    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));

    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });
});

describe('adding a sleep', () => {
  /** Opens the sleep form for the baby selected by default, and returns its fields. */
  async function openSleepForm(): Promise<{ start: HTMLInputElement; end: HTMLInputElement }> {
    await userEvent.click(await screen.findByRole('button', { name: 'Add sleep' }));

    return {
      start: await screen.findByLabelText('Start'),
      end: screen.getByLabelText('End'),
    };
  }

  it('opens the sleep form when the Add sleep action is used', async () => {
    stubApi({});
    renderToday();

    // The action is offered next to the other two, and no form is open yet.
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDefined();
    expect(screen.queryByLabelText('Start')).toBeNull();

    const { start, end } = await openSleepForm();

    expect(screen.getByRole('heading', { name: 'New sleep' })).toBeDefined();
    // The start is defaulted to the current local time; the end is deliberately
    // left for the parent, so a sleep is never saved with a made-up length.
    expect(start.value).toMatch(/^\d{2}:\d{2}$/);
    expect(end.value).toBe('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    // The other forms are separate actions, not this one.
    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(screen.queryByLabelText('Amount')).toBeNull();
  });

  it('requires an end time before anything is sent', async () => {
    stubApi({});
    renderToday();

    await openSleepForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter an end time.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
    // Still open, so the parent can simply fill it in.
    expect(screen.getByLabelText('End')).toBeDefined();
  });

  it('rejects a cleared start time without sending anything', async () => {
    stubApi({});
    renderToday();

    const { start, end } = await openSleepForm();
    setTime(start, '');
    setTime(end, '08:45');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter a valid start time.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });

  it('reads an end earlier than the start as the next day', async () => {
    stubApi({});
    renderToday();

    const { start, end } = await openSleepForm();
    setTime(start, '23:00');
    setTime(end, '01:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // One session crossing midnight (D5): the start stays on today, the end
    // lands on tomorrow, and the two instants are two hours apart.
    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'SLEEP',
          startedAt: startedAtFor('23:00'),
          endedAt: startedAtFor('01:00', 1),
        },
      ]);
    });

    const [body] = createdEventBodies() as { startedAt: string; endedAt: string }[];
    expect(Date.parse(body?.endedAt ?? '') - Date.parse(body?.startedAt ?? '')).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  it('keeps an ordinary evening sleep on the same day', async () => {
    stubApi({});
    renderToday();

    const { start, end } = await openSleepForm();
    setTime(start, '20:00');
    setTime(end, '22:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Nothing rolls over while the end is later than the start.
    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'SLEEP',
          startedAt: startedAtFor('20:00'),
          endedAt: startedAtFor('22:30'),
        },
      ]);
    });
  });

  it('sends a SLEEP event for the selected baby, with a start and an end', async () => {
    stubApi({});
    renderToday();

    const { start, end } = await openSleepForm();
    setTime(start, '07:30');
    setTime(end, '08:45');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'SLEEP',
          startedAt: startedAtFor('07:30'),
          endedAt: startedAtFor('08:45'),
        },
      ]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${ANI_ID}/events`);
  });

  it('posts to the baby that is selected, not the first one', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('tab', { name: 'Nare' }));

    const { start, end } = await openSleepForm();
    setTime(start, '09:00');
    setTime(end, '10:10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toHaveLength(1);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${NARE_ID}/events`);
  });

  it('closes the form and reloads the events once the sleep is saved', async () => {
    const sleep = event('event-sleep', ANI_ID, {
      type: 'SLEEP',
      startedAt: '2026-09-08T09:00:00.000Z',
      endedAt: '2026-09-08T10:10:00.000Z',
    });
    let saved = false;

    stubApi({
      events: () => Promise.resolve(json({ events: saved ? [sleep] : [] })),
      createEvent: (babyId) => {
        saved = true;
        return Promise.resolve(json({ event: event('event-sleep', babyId) }, 201));
      },
    });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();

    const { start, end } = await openSleepForm();
    setTime(start, '09:00');
    setTime(end, '10:10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The new sleep is on screen, with its duration, and the form is gone.
    expect(await screen.findByText('1h 10m')).toBeDefined();
    expect(screen.queryByLabelText('End')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add sleep' })).toBeDefined();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
  });

  it('closes the form without sending anything when cancelled', async () => {
    stubApi({});
    renderToday();

    const { end } = await openSleepForm();
    setTime(end, '08:45');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('End')).toBeNull();
    expect(createdEventBodies()).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add sleep' })).toBeDefined();
  });

  it('reports a failed save and keeps what was entered', async () => {
    stubApi({ createEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    const { start, end } = await openSleepForm();
    setTime(start, '07:30');
    setTime(end, '08:45');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not save the sleep. Please try again.',
    );
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('07:30');
    expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('08:45');
  });

  it('closes an unfinished sleep form when the baby is switched', async () => {
    stubApi({});
    renderToday();

    const { end } = await openSleepForm();
    setTime(end, '08:45');

    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));

    expect(screen.queryByLabelText('End')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add sleep' })).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });
});

describe('adding a nappy', () => {
  /** Opens the nappy form for the baby selected by default, and returns its fields. */
  async function openDiaperForm(): Promise<{ time: HTMLInputElement }> {
    await userEvent.click(await screen.findByRole('button', { name: 'Add nappy' }));

    return { time: await screen.findByLabelText('Time') };
  }

  /** One of the four kind radios, by its translated label. */
  const kindRadio = (label: string): HTMLInputElement =>
    screen.getByRole('radio', { name: label }) as HTMLInputElement;

  it('opens the nappy form when the Add nappy action is used', async () => {
    stubApi({});
    renderToday();

    // The action is offered next to the other three, and no form is open yet.
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add sleep' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();

    const { time } = await openDiaperForm();

    expect(screen.getByRole('heading', { name: 'New nappy' })).toBeDefined();
    // Defaulted to the current local time rather than left empty.
    expect(time.value).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    // The other forms are separate actions, not this one.
    expect(screen.queryByLabelText('Note')).toBeNull();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.queryByLabelText('End')).toBeNull();
  });

  it('offers the four shared diaper kinds, with the commonest preselected', async () => {
    stubApi({});
    renderToday();

    await openDiaperForm();

    // The vocabulary is DIAPER_KINDS from the shared package, in its order.
    // Read off the labels, which is what a parent sees and what gives each
    // visually hidden radio its accessible name. Only the kind radios: the form
    // also carries the target radios, which are a different question.
    const kindLabels = screen
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('name') === 'kind')
      .map((radio) => radio.closest('label')?.textContent?.trim());
    expect(kindLabels).toEqual(['Wet', 'Dirty', 'Wet and dirty', 'Dry']);
    // Two taps rather than three for the change a parent makes most often.
    expect(kindRadio('Wet').checked).toBe(true);
    expect(kindRadio('Dry').checked).toBe(false);
  });

  it('sends a DIAPER event for the selected baby, defaulting to a wet nappy', async () => {
    stubApi({});
    renderToday();

    const { time } = await openDiaperForm();
    const chosenTime = time.value;

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'DIAPER',
          startedAt: startedAtFor(chosenTime),
          details: 'wet',
        },
      ]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${ANI_ID}/events`);
  });

  it('sends the canonical kind token, not the label the parent read', async () => {
    stubApi({});
    renderToday();

    await openDiaperForm();
    await userEvent.click(kindRadio('Wet and dirty'));

    expect(kindRadio('Wet and dirty').checked).toBe(true);
    expect(kindRadio('Wet').checked).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // `wet_and_dirty`, never "Wet and dirty": what is stored must not depend on
    // the language the parent happened to be using.
    await waitFor(() => {
      expect(createdEventBodies()).toMatchObject([{ type: 'DIAPER', details: 'wet_and_dirty' }]);
    });
  });

  it('rejects a cleared time without sending anything', async () => {
    stubApi({});
    renderToday();

    const { time } = await openDiaperForm();
    setTime(time, '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter a valid time.')).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
    // Still open, so the parent can simply pick a time.
    expect(screen.getByLabelText('Time')).toBeDefined();
  });

  it('posts to the baby that is selected, not the first one', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('tab', { name: 'Nare' }));

    await openDiaperForm();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toHaveLength(1);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies/${NARE_ID}/events`);
  });

  it('closes the form and reloads the events once the nappy is saved', async () => {
    const diaper = event('event-diaper', ANI_ID, { type: 'DIAPER', details: 'dirty' });
    let saved = false;

    stubApi({
      events: () => Promise.resolve(json({ events: saved ? [diaper] : [] })),
      createEvent: (babyId) => {
        saved = true;
        return Promise.resolve(json({ event: event('event-diaper', babyId) }, 201));
      },
    });
    renderToday();

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();

    await openDiaperForm();
    await userEvent.click(kindRadio('Dirty'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The new nappy is on screen, and the form is gone.
    expect(await screen.findByText('Dirty')).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add nappy' })).toBeDefined();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
  });

  it('closes the form without sending anything when cancelled', async () => {
    stubApi({});
    renderToday();

    await openDiaperForm();
    await userEvent.click(kindRadio('Dry'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('radio')).toBeNull();
    expect(createdEventBodies()).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add nappy' })).toBeDefined();
  });

  it('reports a failed save and keeps what was entered', async () => {
    stubApi({ createEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
    renderToday();

    const { time } = await openDiaperForm();
    setTime(time, '07:30');
    await userEvent.click(kindRadio('Wet and dirty'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not save the nappy change. Please try again.',
    );
    // Nothing is cleared: the parent retries rather than re-entering.
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('07:30');
    expect(kindRadio('Wet and dirty').checked).toBe(true);
  });

  it('closes an unfinished nappy form when the baby is switched', async () => {
    stubApi({});
    renderToday();

    await openDiaperForm();
    await userEvent.click(kindRadio('Dry'));

    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));

    expect(screen.queryByRole('radio')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add nappy' })).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });

  it('shows a saved nappy by its translated kind, not its stored token', async () => {
    const diaper = event('event-diaper', ANI_ID, { type: 'DIAPER', details: 'wet_and_dirty' });
    stubApi({ events: () => Promise.resolve(json({ events: [diaper] })) });
    renderToday();

    const card = await eventsCard();
    const item = (await within(card).findAllByRole('listitem'))[0] as HTMLElement;

    expect(within(item).getByText('Nappy')).toBeDefined();
    expect(within(item).getByText('Wet and dirty')).toBeDefined();
    expect(within(item).queryByText('wet_and_dirty')).toBeNull();
  });

  it('shows a diaper whose details are not one of the four exactly as entered', async () => {
    const diaper = event('event-diaper', ANI_ID, { type: 'DIAPER', details: 'leaked everywhere' });
    stubApi({ events: () => Promise.resolve(json({ events: [diaper] })) });
    renderToday();

    const card = await eventsCard();
    const item = (await within(card).findAllByRole('listitem'))[0] as HTMLElement;

    expect(within(item).getByText('leaked everywhere')).toBeDefined();
  });
});

describe('creating the first family', () => {
  /** No family yet — the state a freshly registered account starts in. */
  const noFamilies = () => Promise.resolve(json({ families: [] }));

  /** Waits for the create form, and returns its name field. */
  async function nameField(): Promise<HTMLInputElement> {
    return (await screen.findByLabelText('Family name')) as HTMLInputElement;
  }

  it('offers a create-family form instead of a dead end', async () => {
    stubApi({ families: noFamilies });
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Create your family' })).toBeDefined();
    expect((await nameField()).value).toBe('');
    expect(screen.getByRole('button', { name: 'Create family' })).toBeDefined();
    // Nothing baby-shaped is on screen yet: there is no family to hold one.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });

  it('requires a name before anything is sent', async () => {
    stubApi({ families: noFamilies });
    renderToday();

    await nameField();
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    expect(await screen.findByText('Please enter a family name.')).toBeDefined();
    expect(createdFamilyBodies()).toEqual([]);
    // Still open, so the parent can simply type.
    expect(screen.getByLabelText('Family name')).toBeDefined();
  });

  it('treats a name of only spaces as empty', async () => {
    stubApi({ families: noFamilies });
    renderToday();

    await userEvent.type(await nameField(), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    expect(await screen.findByText('Please enter a family name.')).toBeDefined();
    expect(createdFamilyBodies()).toEqual([]);
  });

  it('rejects a name longer than the shared contract allows', async () => {
    stubApi({ families: noFamilies });
    renderToday();

    // 81 characters: one past the shared `familyNameSchema` maximum, entered as
    // a paste would be rather than one keystroke at a time.
    fireEvent.change(await nameField(), { target: { value: 'a'.repeat(81) } });
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    expect(await screen.findByText('That name is too long.')).toBeDefined();
    expect(createdFamilyBodies()).toEqual([]);
  });

  it('sends the trimmed name to the existing families endpoint', async () => {
    stubApi({ families: noFamilies });
    renderToday();

    await userEvent.type(await nameField(), '  Sultanova  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    await waitFor(() => {
      expect(createdFamilyBodies()).toEqual([{ name: 'Sultanova' }]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain('/families');
  });

  it('shows the tracker for the new family without a reload', async () => {
    let created = false;

    stubApi({
      families: () => Promise.resolve(json({ families: created ? [family] : [] })),
      createFamily: () => {
        created = true;
        return Promise.resolve(json({ family }, 201));
      },
    });
    renderToday();

    await userEvent.type(await nameField(), 'Sultanova');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    // The families query is refetched, the babies of the new family load, and
    // the form is gone — all without the page being reloaded.
    expect(await screen.findByRole('tab', { name: 'Ani' })).toBeDefined();
    expect(screen.queryByLabelText('Family name')).toBeNull();
  });

  it('reports a failed creation and keeps what was typed', async () => {
    stubApi({
      families: noFamilies,
      createFamily: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')),
    });
    renderToday();

    await userEvent.type(await nameField(), 'Sultanova');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not create the family. Please try again.',
    );
    expect((screen.getByLabelText('Family name') as HTMLInputElement).value).toBe('Sultanova');
  });

  it('disables the action while the family is being created', async () => {
    stubApi({ families: noFamilies, createFamily: never });
    renderToday();

    await userEvent.type(await nameField(), 'Sultanova');
    await userEvent.click(screen.getByRole('button', { name: 'Create family' }));

    const submitting = await screen.findByRole('button', { name: 'Creating…' });
    expect((submitting as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Family name') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('adding a baby', () => {
  /** A family that exists but holds no babies — where family creation leaves you. */
  const noBabies = () => Promise.resolve(json({ babies: [] }));

  /** Waits for the add-baby form, and returns its fields. */
  async function babyFields(): Promise<{ name: HTMLInputElement; birthDate: HTMLInputElement }> {
    return {
      name: (await screen.findByLabelText('Name')) as HTMLInputElement,
      birthDate: screen.getByLabelText('Birth date (optional)') as HTMLInputElement,
    };
  }

  /** One of the three gender radios, by its translated label. */
  const genderRadio = (label: string): HTMLInputElement =>
    screen.getByRole('radio', { name: label }) as HTMLInputElement;

  it('offers an add-baby form instead of a dead end', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Add a baby' })).toBeDefined();

    const { name, birthDate } = await babyFields();
    expect(name.value).toBe('');
    // Both optional fields start empty: nothing is recorded that was not entered.
    expect(birthDate.value).toBe('');
    expect(genderRadio('Not specified').checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Add baby' })).toBeDefined();
    // Nothing to go back to, so no cancel and no tracker behind it.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('offers one form for both babies rather than a twin flow', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    await babyFields();

    // Twins are two uses of this form (spec §6), not an action of their own.
    expect(screen.queryByRole('button', { name: /twin/i })).toBeNull();
    expect(screen.queryByLabelText(/twin/i)).toBeNull();
  });

  it('requires a name before anything is sent', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    await babyFields();
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    expect(await screen.findByText('Please enter a name.')).toBeDefined();
    expect(createdBabyBodies()).toEqual([]);
    // Still open, so the parent can simply type.
    expect(screen.getByLabelText('Name')).toBeDefined();
  });

  it('treats a name of only spaces as empty', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    const { name } = await babyFields();
    await userEvent.type(name, '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    expect(await screen.findByText('Please enter a name.')).toBeDefined();
    expect(createdBabyBodies()).toEqual([]);
  });

  it('rejects a name longer than the shared contract allows', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    // 81 characters: one past the shared `babyNameSchema` maximum, entered as a
    // paste would be rather than one keystroke at a time.
    const { name } = await babyFields();
    fireEvent.change(name, { target: { value: 'a'.repeat(81) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    expect(await screen.findByText('That name is too long.')).toBeDefined();
    expect(createdBabyBodies()).toEqual([]);
  });

  it('sends the trimmed name alone when the optional fields are left empty', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    const { name } = await babyFields();
    await userEvent.type(name, '  Ani  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    // No `birthDate` and no `gender` keys at all: absence is what the contract
    // makes optional, not an empty value.
    await waitFor(() => {
      expect(createdBabyBodies()).toEqual([{ name: 'Ani' }]);
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(posted?.[0])).toContain(`/families/${FAMILY_ID}/babies`);
  });

  it('sends the birth date and the gender when they are given', async () => {
    stubApi({ babies: noBabies });
    renderToday();

    const { name, birthDate } = await babyFields();
    await userEvent.type(name, 'Nare');
    fireEvent.change(birthDate, { target: { value: '2026-01-05' } });
    await userEvent.click(genderRadio('Girl'));

    expect(genderRadio('Girl').checked).toBe(true);
    expect(genderRadio('Not specified').checked).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    // `FEMALE`, never "Girl": what is stored must not depend on the language
    // the parent happened to be using.
    await waitFor(() => {
      expect(createdBabyBodies()).toEqual([
        { name: 'Nare', birthDate: '2026-01-05T00:00:00.000Z', gender: 'FEMALE' },
      ]);
    });
  });

  it('shows the tracker for the new baby without a reload', async () => {
    let created = false;

    stubApi({
      babies: () => Promise.resolve(json({ babies: created ? [baby(ANI_ID, 'Ani')] : [] })),
      createBaby: () => {
        created = true;
        return Promise.resolve(json({ baby: baby(ANI_ID, 'Ani') }, 201));
      },
    });
    renderToday();

    const { name } = await babyFields();
    await userEvent.type(name, 'Ani');
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    // The babies query is refetched, the tracker appears, and the form is gone
    // — all without the page being reloaded.
    expect(await screen.findByRole('tab', { name: 'Ani' })).toBeDefined();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
  });

  it('adds the second twin through the same form, from the tracker', async () => {
    let babyList: Baby[] = [baby(ANI_ID, 'Ani')];

    stubApi({
      babies: () => Promise.resolve(json({ babies: babyList })),
      createBaby: () => {
        babyList = [baby(ANI_ID, 'Ani'), baby(NARE_ID, 'Nare')];
        return Promise.resolve(json({ baby: baby(NARE_ID, 'Nare') }, 201));
      },
    });
    renderToday();

    // One baby so far, and the tracker offers the same form to add another.
    expect(await screen.findByRole('tab', { name: 'Ani' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    const { name } = await babyFields();
    await userEvent.type(name, 'Nare');
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    // Two independent babies, one tab each — no twin flow and no twin payload.
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map(spokenText)).toEqual(['Ani', 'Nare']);
    expect(createdBabyBodies()).toEqual([{ name: 'Nare' }]);
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('leaves the tracker untouched when the form is cancelled', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add baby' }));

    const { name } = await babyFields();
    await userEvent.type(name, 'Never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(createdBabyBodies()).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
  });

  it('reports a failed creation and keeps what was entered', async () => {
    stubApi({
      babies: noBabies,
      createBaby: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')),
    });
    renderToday();

    const { name, birthDate } = await babyFields();
    await userEvent.type(name, 'Ani');
    fireEvent.change(birthDate, { target: { value: '2026-01-05' } });
    await userEvent.click(genderRadio('Boy'));
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not add the baby. Please try again.',
    );
    // Nothing is cleared: the parent retries rather than re-entering.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ani');
    expect((screen.getByLabelText('Birth date (optional)') as HTMLInputElement).value).toBe(
      '2026-01-05',
    );
    expect(genderRadio('Boy').checked).toBe(true);
  });

  it('disables the action while the baby is being created', async () => {
    stubApi({ babies: noBabies, createBaby: never });
    renderToday();

    const { name } = await babyFields();
    await userEvent.type(name, 'Ani');
    await userEvent.click(screen.getByRole('button', { name: 'Add baby' }));

    const submitting = await screen.findByRole('button', { name: 'Adding…' });
    expect((submitting as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    // The whole gender group, disabled through its fieldset rather than radio
    // by radio — asserted where the attribute actually is.
    expect(
      (screen.getByRole('group', { name: 'Gender (optional)' }) as HTMLFieldSetElement).disabled,
    ).toBe(true);
  });
});

describe('event rows', () => {
  /** Decorative, so a row's icon is found the way its `<time>` is: by the DOM. */
  const iconOf = (row: HTMLElement): Element | null => row.querySelector('[data-icon]');

  /** Renders one event of the given shape and returns its row. */
  async function rowFor(overrides: Partial<BabyEvent>): Promise<HTMLElement> {
    stubApi({
      events: () => Promise.resolve(json({ events: [event('event-1', ANI_ID, overrides)] })),
    });
    renderToday();
    return firstEventRow();
  }

  it('marks a feeding with a bottle, without replacing the type name', async () => {
    const row = await rowFor({ type: 'FEEDING' });

    expect(iconOf(row)?.getAttribute('data-icon')).toBe('bottle');
    // The icon adds nothing to the accessibility tree; the words still carry it.
    expect(iconOf(row)?.getAttribute('aria-hidden')).toBe('true');
    expect(within(row).getByText('Feeding')).toBeDefined();
  });

  it('marks a sleep with a moon', async () => {
    const row = await rowFor({ type: 'SLEEP' });

    expect(iconOf(row)?.getAttribute('data-icon')).toBe('moon');
    expect(within(row).getByText('Sleep')).toBeDefined();
  });

  it('marks a nappy with a nappy', async () => {
    const row = await rowFor({ type: 'DIAPER', details: 'wet' });

    expect(iconOf(row)?.getAttribute('data-icon')).toBe('diaper');
    expect(within(row).getByText('Nappy')).toBeDefined();
  });

  it('marks a note with a page', async () => {
    const row = await rowFor({ type: 'NOTE', details: 'Smiled at the window' });

    expect(iconOf(row)?.getAttribute('data-icon')).toBe('note');
    expect(within(row).getByText('Note')).toBeDefined();
  });

  it('gives every row an Edit and a Delete action', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: aniEvents })) });
    renderToday();

    const rows = await eventRows();
    expect(rows).toHaveLength(2);

    expect(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Edit Feeding' }),
    ).toBeDefined();
    expect(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Delete Feeding' }),
    ).toBeDefined();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Edit Sleep' }),
    ).toBeDefined();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Delete Sleep' }),
    ).toBeDefined();
  });
});

describe('editing an event', () => {
  /** A feeding recorded at a known local time, so its form fields are predictable. */
  const feeding = (overrides: Partial<BabyEvent> = {}): BabyEvent =>
    event('event-ani-1', ANI_ID, {
      type: 'FEEDING',
      startedAt: startedAtFor('07:30'),
      amount: 120,
      unit: 'ml',
      ...overrides,
    });

  /** Opens the edit form on the first row, by the action a parent would tap. */
  async function openEdit(name: string): Promise<void> {
    const row = await firstEventRow();
    await userEvent.click(within(row).getByRole('button', { name }));
  }

  it('opens the matching form, filled in with what was stored', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding()] })) });
    renderToday();

    await openEdit('Edit Feeding');

    // The feeding form, in its editing title, holding the stored values.
    expect(screen.getByRole('heading', { name: 'Edit feeding' })).toBeDefined();
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('07:30');
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('120');
    // Stored volumes are canonical millilitres (D3), so that is what is shown.
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('ml');
  });

  it('opens the form belonging to the event, not the last one used', async () => {
    const note = event('event-ani-9', ANI_ID, {
      type: 'NOTE',
      startedAt: startedAtFor('09:15'),
      details: 'Smiled at the window',
    });
    stubApi({ events: () => Promise.resolve(json({ events: [note] })) });
    renderToday();

    await openEdit('Edit Note');

    expect(screen.getByRole('heading', { name: 'Edit note' })).toBeDefined();
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe(
      'Smiled at the window',
    );
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('09:15');
    expect(screen.queryByLabelText('Amount')).toBeNull();
  });

  it('sends a PATCH to the event being edited, and nothing else', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding()] })) });
    renderToday();

    await openEdit('Edit Feeding');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(patchedEvents()).toHaveLength(1);
    });

    const [patch] = patchedEvents();
    // Path-scoped: the family and the baby are in the URL, never in the body.
    expect(patch?.url).toContain(`/families/${FAMILY_ID}/babies/${ANI_ID}/events/event-ani-1`);
    expect(patch?.body).toEqual({
      type: 'FEEDING',
      startedAt: startedAtFor('07:30'),
      amount: 150,
      unit: 'ml',
    });
    expect(createdEventBodies()).toEqual([]);
  });

  it('closes the form only once the refreshed list holds the change', async () => {
    let stored = feeding();

    stubApi({
      events: () => Promise.resolve(json({ events: [stored] })),
      updateEvent: () => {
        stored = feeding({ amount: 150 });
        return Promise.resolve(json({ event: stored }));
      },
    });
    renderToday();

    await openEdit('Edit Feeding');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The new value is on screen, the form is gone, and the list was re-read
    // for this baby — the events query is refetched, not patched by hand.
    expect(await screen.findByText('150 ml')).toBeDefined();
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
  });

  it('keeps the form open, with what was entered, when the edit fails', async () => {
    stubApi({
      events: () => Promise.resolve(json({ events: [feeding()] })),
      updateEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')),
    });
    renderToday();

    await openEdit('Edit Feeding');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not update the feeding. Please try again.',
    );
    // Nothing is cleared and nothing is closed: the parent retries.
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('150');
    expect(screen.getByRole('heading', { name: 'Edit feeding' })).toBeDefined();
  });

  it('leaves the event untouched when the edit is cancelled', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding()] })) });
    renderToday();

    await openEdit('Edit Feeding');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(patchedEvents()).toEqual([]);
    expect(await screen.findByText('120 ml')).toBeDefined();
  });

  it('stores canonical millilitres when the amount is edited in ounces', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding()] })) });
    renderToday();

    await openEdit('Edit Feeding');
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'oz');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(patchedEvents()).toHaveLength(1);
    });

    // 4 US fl oz is 118.29… ml, converted by the shared `volumeToMl` exactly as
    // the create flow converts it. `oz` never reaches the API.
    expect(patchedEvents()[0]?.body).toMatchObject({ amount: 118, unit: 'ml' });
  });

  describe('a sleep', () => {
    const sameDaySleep = event('event-sleep', ANI_ID, {
      type: 'SLEEP',
      startedAt: startedAtFor('13:00'),
      endedAt: startedAtFor('14:30'),
    });

    /** 23:00 → 01:00, the overnight session decision D5 keeps whole. */
    const overnight = event('event-sleep', ANI_ID, {
      type: 'SLEEP',
      startedAt: startedAtFor('23:00'),
      endedAt: startedAtFor('01:00', 1),
    });

    it('is filled in with both of its times', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [sameDaySleep] })) });
      renderToday();

      await openEdit('Edit Sleep');

      expect(screen.getByRole('heading', { name: 'Edit sleep' })).toBeDefined();
      expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('13:00');
      expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('14:30');
    });

    it('keeps a same-day sleep on its own day when it is edited', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [sameDaySleep] })) });
      renderToday();

      await openEdit('Edit Sleep');
      setTime(screen.getByLabelText('End') as HTMLInputElement, '15:00');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(patchedEvents()).toHaveLength(1);
      });
      expect(patchedEvents()[0]?.body).toEqual({
        type: 'SLEEP',
        startedAt: startedAtFor('13:00'),
        endedAt: startedAtFor('15:00'),
      });
    });

    it('shows an overnight sleep by its clock times, not shifted onto today', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [overnight] })) });
      renderToday();

      await openEdit('Edit Sleep');

      expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('23:00');
      expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('01:00');
    });

    it('keeps an overnight sleep crossing one midnight when it is edited', async () => {
      let stored = overnight;

      stubApi({
        events: () => Promise.resolve(json({ events: [stored] })),
        updateEvent: () => {
          stored = event('event-sleep', ANI_ID, {
            type: 'SLEEP',
            startedAt: startedAtFor('23:00'),
            endedAt: startedAtFor('02:00', 1),
          });
          return Promise.resolve(json({ event: stored }));
        },
      });
      renderToday();

      await openEdit('Edit Sleep');
      setTime(screen.getByLabelText('End') as HTMLInputElement, '02:00');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(patchedEvents()).toHaveLength(1);
      });

      // The end is read on the day *after* the start, exactly as a new overnight
      // sleep is: the edit does not drag the session onto today, and the two
      // instants stay three hours apart across one midnight.
      const body = patchedEvents()[0]?.body as { startedAt: string; endedAt: string };
      expect(body).toEqual({
        type: 'SLEEP',
        startedAt: startedAtFor('23:00'),
        endedAt: startedAtFor('02:00', 1),
      });
      expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(3 * 60 * 60 * 1000);

      // And the list still derives the duration from those two instants.
      expect(await screen.findByText('3h 0m')).toBeDefined();
    });
  });

  describe('a nappy', () => {
    const diaper = event('event-diaper', ANI_ID, {
      type: 'DIAPER',
      startedAt: startedAtFor('10:15'),
      details: 'wet_and_dirty',
    });

    const kindRadio = (label: string): HTMLInputElement =>
      screen.getByRole('radio', { name: label }) as HTMLInputElement;

    it('opens with the stored kind selected', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [diaper] })) });
      renderToday();

      await openEdit('Edit Nappy');

      expect(screen.getByRole('heading', { name: 'Edit nappy' })).toBeDefined();
      expect(kindRadio('Wet and dirty').checked).toBe(true);
      expect(kindRadio('Wet').checked).toBe(false);
      expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('10:15');
    });

    it('sends the canonical token of the newly chosen kind', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [diaper] })) });
      renderToday();

      await openEdit('Edit Nappy');
      await userEvent.click(kindRadio('Dry'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(patchedEvents()).toHaveLength(1);
      });
      // `dry`, never "Dry": the stored vocabulary does not depend on the
      // language the parent was reading.
      expect(patchedEvents()[0]?.body).toEqual({
        type: 'DIAPER',
        startedAt: startedAtFor('10:15'),
        details: 'dry',
      });
    });
  });

  describe('a note', () => {
    const note = event('event-note', ANI_ID, {
      type: 'NOTE',
      startedAt: startedAtFor('09:15'),
      details: 'Smiled at the window',
    });

    it('sends the edited text', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [note] })) });
      renderToday();

      await openEdit('Edit Note');
      const details = screen.getByLabelText('Note') as HTMLTextAreaElement;
      await userEvent.clear(details);
      await userEvent.type(details, 'Slept through the film');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(patchedEvents()).toHaveLength(1);
      });
      expect(patchedEvents()[0]?.body).toEqual({
        type: 'NOTE',
        startedAt: startedAtFor('09:15'),
        details: 'Slept through the film',
      });
    });

    it('still enforces the shared 1000-character limit', async () => {
      stubApi({ events: () => Promise.resolve(json({ events: [note] })) });
      renderToday();

      await openEdit('Edit Note');
      const details = screen.getByLabelText('Note') as HTMLTextAreaElement;
      expect(details.maxLength).toBe(1000);

      // 1001 characters, entered as a paste would be: one past the shared
      // `eventDetailsSchema` maximum, so nothing is sent.
      fireEvent.change(details, { target: { value: 'a'.repeat(1001) } });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Please write a note.')).toBeDefined();
      expect(patchedEvents()).toEqual([]);
    });
  });

  it('edits only the selected baby’s event, and leaves the other twin alone', async () => {
    stubApi({
      events: (babyId) =>
        Promise.resolve(json({ events: babyId === ANI_ID ? [feeding()] : nareEvents })),
    });
    renderToday();

    await openEdit('Edit Feeding');
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(patchedEvents()).toHaveLength(1);
    });

    // Sent to Ani's event, and only Ani's list is re-read.
    expect(patchedEvents()[0]?.url).toContain(`/babies/${ANI_ID}/events/event-ani-1`);
    await waitFor(() => {
      expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
    });

    // Nare's tab still shows Nare's own events.
    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));
    expect(await screen.findByText('Nappy')).toBeDefined();
    expect(screen.queryByText('120 ml')).toBeNull();
  });
});

describe('deleting an event', () => {
  const feeding = event('event-ani-1', ANI_ID, {
    type: 'FEEDING',
    startedAt: startedAtFor('07:30'),
    amount: 120,
    unit: 'ml',
  });

  /** Taps the row's delete action, which only asks the question. */
  async function askToDelete(): Promise<HTMLElement> {
    const row = await firstEventRow();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete Feeding' }));
    return row;
  }

  it('asks before deleting anything', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding] })) });
    renderToday();

    const row = await askToDelete();

    // Nothing has been sent, the event is still listed, and the parent is
    // offered both ways out.
    expect(deletedEventUrls()).toEqual([]);
    expect(within(row).getByText('Delete this event? This cannot be undone.')).toBeDefined();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDefined();
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByText('120 ml')).toBeDefined();
  });

  it('leaves the event alone when the confirmation is cancelled', async () => {
    stubApi({ events: () => Promise.resolve(json({ events: [feeding] })) });
    renderToday();

    const row = await askToDelete();
    await userEvent.click(within(row).getByRole('button', { name: 'Cancel' }));

    expect(deletedEventUrls()).toEqual([]);
    expect(screen.getByText('120 ml')).toBeDefined();
    // Back to the row's ordinary actions.
    expect(within(row).getByRole('button', { name: 'Delete Feeding' })).toBeDefined();
    expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('deletes the event and refreshes the list once confirmed', async () => {
    let deleted = false;

    stubApi({
      events: () => Promise.resolve(json({ events: deleted ? [] : [feeding] })),
      deleteEvent: () => {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    renderToday();

    const row = await askToDelete();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    // The row is gone because the refreshed list no longer holds it, and the
    // parent is still on the Today page.
    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();
    expect(deletedEventUrls()).toHaveLength(1);
    expect(deletedEventUrls()[0]).toContain(
      `/families/${FAMILY_ID}/babies/${ANI_ID}/events/event-ani-1`,
    );
    expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
    expect(await screen.findByRole('button', { name: 'Add feeding' })).toBeDefined();
  });

  it('keeps the event and reports the failure when the delete fails', async () => {
    stubApi({
      events: () => Promise.resolve(json({ events: [feeding] })),
      deleteEvent: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')),
    });
    renderToday();

    const row = await askToDelete();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not delete the event. Please try again.',
    );
    // Still there: nothing is removed optimistically.
    expect(screen.getByText('120 ml')).toBeDefined();
  });

  it('deletes only the selected baby’s event, and leaves the other twin alone', async () => {
    let deleted = false;

    stubApi({
      events: (babyId) =>
        Promise.resolve(
          json({ events: babyId === ANI_ID ? (deleted ? [] : [feeding]) : nareEvents }),
        ),
      deleteEvent: () => {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    renderToday();

    const row = await askToDelete();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    const card = await eventsCard();
    expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();
    expect(deletedEventUrls()[0]).toContain(`/babies/${ANI_ID}/events/`);
    await waitFor(() => {
      expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
    });

    // Nare's events were never touched, and are still there.
    await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));
    expect(await screen.findByText('Nappy')).toBeDefined();
  });
});

/**
 * Recording one entry for both babies.
 *
 * "Both" is a target chosen inside the entry form, not a third tab: the tab
 * strip stays a view filter, the selected baby does not change, and what the API
 * is asked for is one family-scoped request that writes an ordinary event for
 * each baby (decision D2). These tests are about that boundary — which endpoint
 * is called, with what, and which lists refresh afterwards.
 */
describe('recording for both babies', () => {
  /** The target radio with this label, from the open form. */
  const targetRadio = (label: string): HTMLInputElement =>
    screen.getByRole('radio', { name: label }) as HTMLInputElement;

  /** The labels of the target radios, in the order the form offers them. */
  const targetLabels = (): (string | undefined)[] =>
    screen
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('name') === 'target')
      .map((radio) => radio.closest('label')?.textContent?.trim());

  /** Opens one of the four entry forms and aims it at both babies. */
  async function openFormForBoth(action: string): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: action }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Both' }));
  }

  describe('the target selector', () => {
    it('offers each baby and Both, with the baby on screen already chosen', async () => {
      stubApi({});
      renderToday();

      await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));

      // The babies are named, exactly as the tab strip names them.
      expect(targetLabels()).toEqual(['Ani', 'Nare', 'Both']);
      expect(targetRadio('Ani').checked).toBe(true);
      expect(targetRadio('Nare').checked).toBe(false);
      expect(targetRadio('Both').checked).toBe(false);
    });

    it('defaults to the other twin when that is the one being viewed', async () => {
      stubApi({});
      renderToday();

      await userEvent.click(await screen.findByRole('tab', { name: 'Nare' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Add sleep' }));

      expect(targetRadio('Nare').checked).toBe(true);
      expect(targetRadio('Ani').checked).toBe(false);
      // And the tab strip is unchanged: it is a view filter, not a target.
      expect(screen.getByRole('tab', { name: 'Nare', selected: true })).toBeDefined();
    });

    it('can be moved to Both, and back to one baby', async () => {
      stubApi({});
      renderToday();

      await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));
      await userEvent.click(targetRadio('Both'));
      expect(targetRadio('Both').checked).toBe(true);
      expect(targetRadio('Ani').checked).toBe(false);

      await userEvent.click(targetRadio('Ani'));
      expect(targetRadio('Ani').checked).toBe(true);
      expect(targetRadio('Both').checked).toBe(false);
    });

    it('is offered by all four entry forms', async () => {
      stubApi({});
      renderToday();

      for (const action of ['Add feeding', 'Add sleep', 'Add nappy', 'Add note']) {
        await userEvent.click(await screen.findByRole('button', { name: action }));
        expect(screen.getByRole('radio', { name: 'Both' }), action).toBeDefined();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      }
    });

    it('is not offered while editing: an event belongs to its own baby', async () => {
      const note = event('event-note', ANI_ID, { type: 'NOTE', details: 'Smiled' });
      stubApi({ events: () => Promise.resolve(json({ events: [note] })) });
      renderToday();

      const row = await firstEventRow();
      await userEvent.click(within(row).getByRole('button', { name: 'Edit Note' }));

      expect(await screen.findByRole('heading', { name: 'Edit note' })).toBeDefined();
      expect(screen.queryByRole('radio', { name: 'Both' })).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Nare' })).toBeNull();
    });

    it('is not offered to a family with only one baby', async () => {
      stubApi({ babies: () => Promise.resolve(json({ babies: [babies[0]] })) });
      renderToday();

      await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));

      // Nothing to choose between, so no question is asked.
      expect(screen.queryByRole('radio', { name: 'Both' })).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Ani' })).toBeNull();
    });
  });

  describe('what is sent', () => {
    it('makes one family-scoped request instead of two per-baby ones', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupUrls()).toEqual([`/api/v1/families/${FAMILY_ID}/event-groups`]);
      });
      // Never one write per baby: the pair has to be written atomically.
      expect(createdSingleEvents()).toEqual([]);
    });

    it('never supplies a groupId — the server decides how the pair is linked', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toHaveLength(1);
      });
      const [body] = createdGroupBodies() as Record<string, unknown>[];
      expect(body).not.toHaveProperty('groupId');
      expect(body).not.toHaveProperty('babyId');
      expect(body).not.toHaveProperty('familyId');
    });

    it('sends a feeding in canonical millilitres, once', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add feeding');
      await userEvent.click(screen.getByRole('radio', { name: 'Expressed milk' }));
      const time = screen.getByLabelText('Time') as HTMLInputElement;
      const chosenTime = time.value;
      await userEvent.type(screen.getByLabelText('Amount'), '120');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toEqual([
          {
            type: 'FEEDING',
            startedAt: startedAtFor(chosenTime),
            amount: 120,
            unit: 'ml',
            feeding: { kind: 'expressed_milk' },
          },
        ]);
      });
    });

    it('converts a feeding entered in ounces before sending it for both', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add feeding');
      await userEvent.click(screen.getByRole('radio', { name: 'Formula' }));
      await userEvent.type(screen.getByLabelText('Amount'), '4');
      await userEvent.selectOptions(screen.getByLabelText('Unit'), 'oz');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toHaveLength(1);
      });
      const [body] = createdGroupBodies() as { amount: number; unit: string }[];
      // The same canonical amount each baby gets — no ounce reaches the API.
      expect(body?.unit).toBe('ml');
      // The shared conversion, not a number copied out of it.
      expect(body?.amount).toBe(volumeToMl(4, 'oz'));
    });

    it('sends a sleep’s start and end for both', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add sleep');
      setTime(screen.getByLabelText('Start') as HTMLInputElement, '13:00');
      setTime(screen.getByLabelText('End') as HTMLInputElement, '14:10');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toEqual([
          {
            type: 'SLEEP',
            startedAt: startedAtFor('13:00'),
            endedAt: startedAtFor('14:10'),
          },
        ]);
      });
    });

    it('keeps a sleep that crosses midnight one session for both (D5)', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add sleep');
      setTime(screen.getByLabelText('Start') as HTMLInputElement, '23:00');
      setTime(screen.getByLabelText('End') as HTMLInputElement, '01:00');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toEqual([
          {
            type: 'SLEEP',
            startedAt: startedAtFor('23:00'),
            endedAt: startedAtFor('01:00', 1),
          },
        ]);
      });
      const [body] = createdGroupBodies() as { startedAt: string; endedAt: string }[];
      expect(Date.parse(body?.endedAt ?? '') - Date.parse(body?.startedAt ?? '')).toBe(
        2 * 60 * 60 * 1000,
      );
    });

    it('sends the canonical nappy kind for both', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add nappy');
      await userEvent.click(screen.getByRole('radio', { name: 'Wet and dirty' }));
      const chosenTime = (screen.getByLabelText('Time') as HTMLInputElement).value;
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toEqual([
          {
            type: 'DIAPER',
            startedAt: startedAtFor(chosenTime),
            details: 'wet_and_dirty',
          },
        ]);
      });
    });

    it('sends a note’s text for both', async () => {
      stubApi({});
      renderToday();

      await openFormForBoth('Add note');
      const chosenTime = (screen.getByLabelText('Time') as HTMLInputElement).value;
      await userEvent.type(screen.getByLabelText('Note'), 'Both had a quiet morning');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdGroupBodies()).toEqual([
          {
            type: 'NOTE',
            startedAt: startedAtFor(chosenTime),
            details: 'Both had a quiet morning',
          },
        ]);
      });
    });

    it('still posts to one baby’s own endpoint when the target is left alone', async () => {
      stubApi({});
      renderToday();

      await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));
      await userEvent.type(screen.getByLabelText('Note'), 'Just Ani');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createdSingleEvents()).toHaveLength(1);
      });
      expect(createdSingleEvents()[0]?.url).toBe(
        `/api/v1/families/${FAMILY_ID}/babies/${ANI_ID}/events`,
      );
      expect(createdGroupUrls()).toEqual([]);
    });
  });

  describe('afterwards', () => {
    /**
     * An API that starts empty and holds the pair once a both-babies entry has
     * been saved — one ordinary event per baby, exactly as the real one stores
     * them.
     */
    function stubBothCreation(): { saved: () => boolean } {
      let saved = false;
      const pair = bothEvent({ type: 'NOTE', details: 'Both settled' });

      stubApi({
        events: (babyId) =>
          Promise.resolve(
            json({ events: saved ? pair.events.filter((e) => e.babyId === babyId) : [] }),
          ),
        createEventGroup: () => {
          saved = true;
          return Promise.resolve(json({ group: pair }, 201));
        },
      });

      return { saved: () => saved };
    }

    it('closes the form and shows the entry on the day already on screen', async () => {
      stubBothCreation();
      renderToday();

      const card = await eventsCard();
      expect(await within(card).findByText('Nothing recorded yet.')).toBeDefined();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Both settled')).toBeDefined();
      expect(screen.queryByLabelText('Note')).toBeNull();
      expect(await screen.findByRole('button', { name: 'Add note' })).toBeDefined();
      // Ani's list was re-read; the day it was read for is unchanged.
      expect(requestedEventBabyIds()).toEqual([ANI_ID, ANI_ID]);
    });

    it('leaves the selected baby exactly where it was', async () => {
      stubBothCreation();
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      await screen.findByText('Both settled');
      expect(screen.getByRole('tab', { name: 'Ani', selected: true })).toBeDefined();
      expect(screen.getByRole('tab', { name: 'Nare' }).getAttribute('aria-selected')).toBe('false');
    });

    it('shows the other twin’s copy as soon as their tab is opened', async () => {
      stubBothCreation();
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('Both settled');

      await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));

      // No reload: Nare's list was invalidated too, so opening her tab re-reads
      // it and her own copy of the entry is there.
      expect(await screen.findByText('Both settled')).toBeDefined();
      const nareReads = requestedEventReads().filter((read) => read.babyId === NARE_ID);
      expect(nareReads).toHaveLength(1);
      // And it was asked for with the same day range everything else uses.
      expect(nareReads[0]?.from).toBe(expectedDayRange(BROWSER_ZONE).from);
    });

    it('keeps both twins’ lists separate — each holds its own document', async () => {
      stubBothCreation();
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText('Both settled');

      expect((await eventRows()).length).toBe(1);
      await userEvent.click(screen.getByRole('tab', { name: 'Nare' }));
      await screen.findByText('Both settled');
      expect((await eventRows()).length).toBe(1);
    });
  });

  describe('when it fails', () => {
    it('keeps the form open with what was typed, and says so', async () => {
      stubApi({ createEventGroup: () => Promise.resolve(apiError(500, 'INTERNAL_ERROR')) });
      renderToday();

      await openFormForBoth('Add note');
      await userEvent.type(screen.getByLabelText('Note'), 'Both settled');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Could not save the note. Please try again.',
      );
      expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Both settled');
      // Still aimed at both, so the parent can simply try again.
      expect(targetRadio('Both').checked).toBe(true);
    });

    it('reports a refused Both without pretending one baby got the entry', async () => {
      stubApi({ createEventGroup: () => Promise.resolve(apiError(409, 'CONFLICT')) });
      renderToday();

      await openFormForBoth('Add feeding');
      await userEvent.click(screen.getByRole('radio', { name: 'Formula' }));
      await userEvent.type(screen.getByLabelText('Amount'), '120');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Could not save the feeding. Please try again.',
      );
      // Nothing was written to either baby, and nothing was re-read as if it had.
      expect(createdSingleEvents()).toEqual([]);
      expect(requestedEventBabyIds()).toEqual([ANI_ID]);
      expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('120');
    });
  });
});

describe('feeding kinds', () => {
  /** The rows' and the summary's events, all on today's calendar day. */
  const breastFeed = (id: string, start: string, overrides: Partial<BabyEvent> = {}): BabyEvent =>
    event(id, ANI_ID, {
      type: 'FEEDING',
      startedAt: startedAtFor(start),
      feeding: { kind: 'breast', side: 'left' },
      ...overrides,
    });

  it('opens a new feeding on Breast, with no amount to fill in', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));

    expect((screen.getByRole('radio', { name: 'Breast' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.getByLabelText('Start')).toBeDefined();
    expect((screen.getByLabelText('End (optional)') as HTMLInputElement).value).toBe('');
    // Side is a choice, not a default someone has to undo.
    expect((screen.getByRole('radio', { name: 'Left' }) as HTMLInputElement).checked).toBe(false);
  });

  it('records a breastfeed with only a start time', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));
    setTime(screen.getByLabelText('Start') as HTMLInputElement, '03:10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        { type: 'FEEDING', startedAt: startedAtFor('03:10'), feeding: { kind: 'breast' } },
      ]);
    });
  });

  it('records the side and a quick duration as an end time', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Right' }));
    setTime(screen.getByLabelText('Start') as HTMLInputElement, '10:00');
    await userEvent.click(screen.getByRole('button', { name: '15 min' }));

    expect((screen.getByLabelText('End (optional)') as HTMLInputElement).value).toBe('10:15');
    expect(screen.getByRole('button', { name: '15 min' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toEqual([
        {
          type: 'FEEDING',
          startedAt: startedAtFor('10:00'),
          endedAt: startedAtFor('10:15'),
          feeding: { kind: 'breast', side: 'right' },
        },
      ]);
    });
  });

  it('reads an end just after midnight as the next day', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));
    setTime(screen.getByLabelText('Start') as HTMLInputElement, '23:50');
    await userEvent.click(screen.getByRole('button', { name: '20 min' }));
    expect((screen.getByLabelText('End (optional)') as HTMLInputElement).value).toBe('00:10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createdEventBodies()).toHaveLength(1);
    });
    expect(createdEventBodies()[0]).toMatchObject({ endedAt: startedAtFor('00:10', 1) });
  });

  it('questions an end that would make a feed of most of a day', async () => {
    stubApi({});
    renderToday();

    await userEvent.click(await screen.findByRole('button', { name: 'Add feeding' }));
    setTime(screen.getByLabelText('Start') as HTMLInputElement, '10:10');
    setTime(screen.getByLabelText('End (optional)') as HTMLInputElement, '10:05');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('That end time looks too far from the start. Please check it.'),
    ).toBeDefined();
    expect(createdEventBodies()).toEqual([]);
  });

  it('starts a new feeding on the kind of today’s last one', async () => {
    stubApi({
      events: dayScoped([
        breastFeed('early', '01:00'),
        event('later', ANI_ID, {
          startedAt: startedAtFor('02:00'),
          amount: 90,
          unit: 'ml',
          feeding: { kind: 'formula' },
        }),
      ]),
    });
    renderToday();

    await eventRows();
    await userEvent.click(screen.getByRole('button', { name: 'Add feeding' }));

    expect((screen.getByRole('radio', { name: 'Formula' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Amount')).toBeDefined();
  });

  it('shows the kind, side and length of a breastfeed in its row', async () => {
    stubApi({
      events: dayScoped([breastFeed('feed', '01:00', { endedAt: startedAtFor('01:20') })]),
    });
    renderToday();

    const row = await firstEventRow();
    expect(within(row).getByText('Breast · Left')).toBeDefined();
    expect(within(row).getByText('20m')).toBeDefined();
  });

  it('clears the volume when a bottle is edited into a breastfeed', async () => {
    const bottle = event('event-bottle', ANI_ID, {
      startedAt: startedAtFor('01:00'),
      amount: 120,
      unit: 'ml',
      feeding: { kind: 'formula' },
    });
    stubApi({ events: () => Promise.resolve(json({ events: [bottle] })) });
    renderToday();

    const row = await firstEventRow();
    await userEvent.click(within(row).getByRole('button', { name: 'Edit Feeding' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Breast' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(patchedEvents()).toHaveLength(1);
    });
    expect(patchedEvents()[0]?.body).toEqual({
      type: 'FEEDING',
      startedAt: startedAtFor('01:00'),
      feeding: { kind: 'breast' },
      amount: null,
      unit: null,
    });
  });

  it('keeps an older feeding with no kind exactly as it was when only the amount changes', async () => {
    const old = event('event-old', ANI_ID, {
      startedAt: startedAtFor('01:00'),
      amount: 120,
      unit: 'ml',
    });
    stubApi({ events: () => Promise.resolve(json({ events: [old] })) });
    renderToday();

    const row = await firstEventRow();
    await userEvent.click(within(row).getByRole('button', { name: 'Edit Feeding' }));
    for (const label of ['Breast', 'Expressed milk', 'Formula']) {
      expect((screen.getByRole('radio', { name: label }) as HTMLInputElement).checked).toBe(false);
    }
    const amount = screen.getByLabelText('Amount') as HTMLInputElement;
    await userEvent.clear(amount);
    await userEvent.type(amount, '130');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(patchedEvents()).toHaveLength(1);
    });
    expect(patchedEvents()[0]?.body).not.toHaveProperty('feeding');
  });
});

describe('feeding summary', () => {
  /** The summary card, once it is on screen. */
  async function summaryCard(): Promise<HTMLElement> {
    const heading = await screen.findByRole('heading', { name: 'Feedings today' });
    const section = heading.closest('section');
    if (section === null) {
      throw new Error('The summary heading is not inside a section');
    }
    return section;
  }

  /** The value beside a label in the summary's list of figures. */
  function figure(card: HTMLElement, label: string): string {
    const term = within(card).getByText(label);
    return term.nextElementSibling?.textContent ?? '';
  }

  const feed = (id: string, start: string, overrides: Partial<BabyEvent> = {}): BabyEvent =>
    event(id, ANI_ID, {
      type: 'FEEDING',
      startedAt: startedAtFor(start),
      feeding: { kind: 'breast' },
      ...overrides,
    });

  it('counts the day’s feedings, by kind, and adds up only measured bottle volume', async () => {
    stubApi({
      events: dayScoped([
        feed('a', '00:30', { endedAt: startedAtFor('00:50') }),
        feed('b', '03:00', {
          feeding: { kind: 'expressed_milk' },
          amount: 60,
          unit: 'ml',
        }),
        feed('c', '05:30', { feeding: { kind: 'formula' }, amount: 90, unit: 'ml' }),
        event('d', ANI_ID, { type: 'DIAPER', startedAt: startedAtFor('01:00'), details: 'wet' }),
        event('e', ANI_ID, {
          type: 'DIAPER',
          startedAt: startedAtFor('04:00'),
          details: 'wet_and_dirty',
        }),
      ]),
    });
    renderToday();

    const card = await summaryCard();
    expect(within(card).getByText('Feedings: 3')).toBeDefined();
    expect(within(card).getByText('Breast 1')).toBeDefined();
    expect(within(card).getByText('Expressed milk 1')).toBeDefined();
    expect(within(card).getByText('Formula 1')).toBeDefined();
    expect(figure(card, 'Bottle volume (measured)')).toBe('150 ml · bottles: 2');
    expect(figure(card, 'Breastfeeding time')).toBe('20m · timed 1 of 1');
    expect(figure(card, 'Average interval')).toBe('2h 30m');
    expect(figure(card, 'Shortest – longest')).toBe('2h 30m – 2h 30m');
    expect(figure(card, 'Nappies')).toBe('wet 2 · dirty 1');
    expect(card.querySelectorAll('[data-feeding-mark]')).toHaveLength(3);
  });

  it('measures the first interval from yesterday’s last feeding', async () => {
    stubApi({
      events: dayScoped([
        feed('yesterday', '23:00', { startedAt: startedAtFor('23:00', -1) }),
        feed('today', '01:30'),
      ]),
    });
    renderToday();

    const card = await summaryCard();
    await waitFor(() => {
      expect(figure(card, 'Average interval')).toBe('2h 30m');
    });
    // Yesterday was read once, for this, and not shown in today's list.
    expect(previousDayReads().map((read) => read.babyId)).toEqual([ANI_ID]);
    expect(await eventRows()).toHaveLength(1);
  });

  it('explains breastfeeding volume in neutral words, only when there was a breastfeed', async () => {
    stubApi({ events: dayScoped([feed('a', '00:30')]) });
    renderToday();

    const card = await summaryCard();
    expect(within(card).getByText(/Breastfeeding volume isn't measured/)).toBeDefined();
    expect(figure(card, 'Bottle volume (measured)')).toBe('No bottles');
    // Never a verdict on whether it was enough.
    expect(card.textContent).not.toMatch(/enough|too (few|little|much)|low|normal/i);
  });

  it('leaves the note out when every feeding was a bottle', async () => {
    stubApi({
      events: dayScoped([
        feed('a', '00:30', { feeding: { kind: 'formula' }, amount: 90, unit: 'ml' }),
      ]),
    });
    renderToday();

    const card = await summaryCard();
    expect(within(card).queryByText(/Breastfeeding volume isn't measured/)).toBeNull();
    expect(within(card).queryByText('Breastfeeding time')).toBeNull();
  });

  it('says plainly when nothing has been fed yet', async () => {
    stubApi({ events: dayScoped([]) });
    renderToday();

    const card = await summaryCard();
    expect(within(card).getByText('No feedings recorded yet today.')).toBeDefined();
    expect(figure(card, 'Average interval')).toBe('—');
  });
});
