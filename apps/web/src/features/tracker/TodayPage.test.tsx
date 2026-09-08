import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baby, BabyEvent, FamilyWithRole } from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { TodayPage } from './TodayPage.js';

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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const apiError = (status: number, code: string): Response =>
  json({ error: { code, message: code } }, status);

/** Never settles — used to hold a screen in its pending state. */
const never = (): Promise<Response> => new Promise<Response>(() => {});

interface Routes {
  families?: () => Promise<Response>;
  /** POST to the same path as `families`. */
  createFamily?: () => Promise<Response>;
  babies?: () => Promise<Response>;
  events?: (babyId: string) => Promise<Response>;
  /** POST to the same path as `events`. */
  createEvent?: (babyId: string) => Promise<Response>;
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Routes by URL rather than by call order, so a test never depends on the order
 * TanStack Query happens to fire its requests in.
 */
function stubApi(routes: Routes): void {
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    const events = /\/families\/[^/]+\/babies\/([^/]+)\/events$/.exec(url);
    if (events) {
      const babyId = events[1] ?? '';
      if (method === 'POST') {
        return (
          routes.createEvent ??
          ((id: string) => Promise.resolve(json({ event: event('event-new', id) }, 201)))
        )(babyId);
      }
      return (routes.events ?? (() => Promise.resolve(json({ events: [] }))))(babyId);
    }

    if (url.endsWith('/babies')) {
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

/** Event *reads* so far, in order, as baby ids. */
const requestedEventBabyIds = (): string[] =>
  fetchMock.mock.calls
    .filter((call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET')
    .map((call) => /\/babies\/([^/]+)\/events$/.exec(String(call[0])))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] ?? '');

/** The bodies of the family creations made so far, parsed. */
const createdFamilyBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/families'),
    )
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

/** The bodies of the event creations made so far, parsed. */
const createdEventBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

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

function renderToday(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries: an error must surface as an error, not as a long wait.
      queries: { retry: false, staleTime: 0 },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  render(<TodayPage />, { wrapper: Wrapper });
}

/** The events card, once it is on screen — everything above it has resolved. */
async function eventsCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Recent events' });
  const section = heading.closest('section');
  if (section === null) {
    throw new Error('The events card heading is not inside a section');
  }
  return section;
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

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Ani', 'Nare']);
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

  it('shows an empty state when the family has no babies yet', async () => {
    stubApi({ babies: () => Promise.resolve(json({ babies: [] })) });
    renderToday();

    expect(await screen.findByText('No babies in this family yet.')).toBeDefined();
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
    // visually hidden radio its accessible name.
    const kindLabels = screen
      .getAllByRole('radio')
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
