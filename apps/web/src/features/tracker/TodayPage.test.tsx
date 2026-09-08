import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/** The bodies of the event creations made so far, parsed. */
const createdEventBodies = (): unknown[] =>
  fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as unknown);

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
  /** The instant a `HH:MM` shown in the form stands for, in this machine's zone. */
  function startedAtFor(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    return date.toISOString();
  }

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
