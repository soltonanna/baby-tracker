import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baby, FamilyWithRole, PublicUser } from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { AuthContext, type AuthContextValue } from '../auth/AuthContext.js';
import { SettingsPage } from './SettingsPage.js';

/**
 * The Settings screen through its real query layer, with only `fetch` replaced
 * (and the canvas-based image shrinking, which jsdom cannot do).
 */

vi.mock('./imageResize.js', () => ({
  resizeImage: () => Promise.resolve(new Blob(['small'], { type: 'image/jpeg' })),
}));

const FAMILY_ID = 'family-1';

const family = (role: FamilyWithRole['role'] = 'OWNER'): FamilyWithRole => ({
  id: FAMILY_ID,
  name: 'Sultanova',
  createdBy: 'user-1',
  role,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
});

const baby = (id: string, name: string, extra: Partial<Baby> = {}): Baby => ({
  id,
  familyId: FAMILY_ID,
  name,
  createdAt: '2026-06-01T09:00:00.000Z',
  updatedAt: '2026-06-01T09:00:00.000Z',
  ...extra,
});

const ani = baby('b-ani', 'Ani', {
  lastName: 'Sultanova',
  birthDate: '2026-06-01T00:00:00.000Z',
  birthTime: '07:45',
  birthWeightGrams: 3400,
  birthLengthMm: 510,
  notes: 'Born at home',
  gender: 'FEMALE',
  hasPhoto: true,
  photoUpdatedAt: '2026-06-02T00:00:00.000Z',
});
const levon = baby('b-levon', 'Levon');

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

function stubApi(
  role: FamilyWithRole['role'] = 'OWNER',
  { deleteFails = false }: { deleteFails?: boolean } = {},
): void {
  const babies = [ani, levon];
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';

    if (url.endsWith('/photo')) {
      if (method === 'GET')
        return Promise.resolve(
          new Response('img', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        );
      return Promise.resolve(json({ baby: ani }));
    }
    if (/\/babies\/[^/]+$/.test(url)) {
      if (method === 'DELETE')
        return Promise.resolve(
          deleteFails
            ? json({ error: { code: 'FORBIDDEN', message: 'no' } }, 403)
            : new Response(null, { status: 204 }),
        );
      if (method === 'PATCH') return Promise.resolve(json({ baby: ani }));
    }
    if (url.endsWith('/babies')) {
      if (method === 'POST') return Promise.resolve(json({ baby: baby('b-new', 'Mia') }, 201));
      return Promise.resolve(json({ babies }));
    }
    if (url.endsWith('/families')) return Promise.resolve(json({ families: [family(role)] }));
    throw new Error(`Unexpected request in test: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const requests = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(
    (call) =>
      ((call[1] as RequestInit | undefined)?.method ?? 'GET') === method &&
      pattern.test(String(call[0])),
  );

const bodyOf = (call: unknown[]): Record<string, unknown> =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

const user = (units: PublicUser['units'] = { weight: 'kg', length: 'cm', volume: 'ml' }) =>
  ({
    id: 'user-1',
    email: 'parent@example.com',
    displayName: 'Parent',
    locale: 'en',
    timezone: 'Asia/Yerevan',
    units,
    createdAt: '2026-08-01T09:00:00.000Z',
  }) satisfies PublicUser;

function renderPage(units?: PublicUser['units']): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: user(units),
    register: () => Promise.resolve(),
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetSession();
  resetRefreshState();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPage list', () => {
  it('lists every child with the profile facts, weight and length in grams and centimetres too', async () => {
    stubApi();
    renderPage();

    expect(await screen.findByText('Ani Sultanova')).toBeDefined();
    expect(screen.getByText('Levon')).toBeDefined();
    expect(screen.getByText('Born June 1, 2026 at 07:45')).toBeDefined();
    expect(screen.getByText('Birth weight: 3.4 kg · 3,400 g')).toBeDefined();
    expect(screen.getByText('Birth length: 51 cm')).toBeDefined();
    expect(screen.getByText('Born at home')).toBeDefined();
  });

  it('shows pounds and inches with the metric values beside them', async () => {
    stubApi();
    renderPage({ weight: 'lb', length: 'in', volume: 'oz' });

    expect(await screen.findByText('Birth weight: 7.5 lb · 3,400 g')).toBeDefined();
    expect(screen.getByText('Birth length: 20.1 in · 51 cm')).toBeDefined();
  });

  it('fetches a stored photo through the API client, once', async () => {
    stubApi();
    renderPage();
    await screen.findByText('Ani Sultanova');

    await waitFor(() => {
      expect(requests('GET', /\/babies\/b-ani\/photo$/)).toHaveLength(1);
    });
    expect(requests('GET', /\/babies\/b-levon\/photo$/)).toHaveLength(0);
  });

  it('offers Delete to the owner only', async () => {
    stubApi('MEMBER');
    renderPage();
    await screen.findByText('Ani Sultanova');

    expect(screen.getByRole('button', { name: 'Edit Ani' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
});

describe('deleting a child', () => {
  it('asks first, says what goes with the child, and deletes nothing on cancel', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Levon' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete Levon?')).toBeDefined();
    expect(within(dialog).getByText(/every feeding, sleep, diaper, note and growth/)).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(requests('DELETE', /\/babies\//)).toHaveLength(0);
  });

  it('deletes after confirmation and refreshes the list', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Levon' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete Levon' }),
    );

    await waitFor(() => {
      expect(requests('DELETE', /\/babies\/b-levon$/)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('says so when the delete fails, and keeps the dialog open', async () => {
    stubApi('OWNER', { deleteFails: true });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete Levon' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete Levon' }),
    );

    expect(await screen.findByText('Could not delete. Please try again.')).toBeDefined();
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });
});

describe('editing a child', () => {
  it('opens the form with the stored values in the parent’s units, with metric hints', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Ani' }));

    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Ani');
    expect((screen.getByLabelText(/Last name/) as HTMLInputElement).value).toBe('Sultanova');
    expect((screen.getByLabelText(/Time of birth/) as HTMLInputElement).value).toBe('07:45');
    expect((screen.getByLabelText(/Birth weight \(kg\)/) as HTMLInputElement).value).toBe('3.4');
    expect(screen.getByText('= 3,400 g')).toBeDefined();
    expect((screen.getByLabelText(/Birth length \(cm\)/) as HTMLInputElement).value).toBe('51');
    expect((screen.getByLabelText(/Notes/) as HTMLTextAreaElement).value).toBe('Born at home');
  });

  it('saves changed values in grams and millimetres, and clears an emptied field with null', async () => {
    stubApi();
    renderPage({ weight: 'lb', length: 'in', volume: 'oz' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Ani' }));
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText('First name'), 'Anahit');
    await user.clear(screen.getByLabelText(/Last name/));
    await user.clear(screen.getByLabelText(/Birth weight/));
    await user.type(screen.getByLabelText(/Birth weight/), '8');
    expect(screen.getByText('= 3,629 g')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(requests('PATCH', /\/babies\/b-ani$/)).toHaveLength(1);
    });
    const body = bodyOf(requests('PATCH', /\/babies\/b-ani$/)[0] ?? []);
    expect(body).toMatchObject({
      name: 'Anahit',
      lastName: null,
      birthWeightGrams: 3629,
      birthTime: '07:45',
      birthLengthMm: 510,
      notes: 'Born at home',
    });
    // The photo was not touched.
    expect(requests('PUT', /photo$/)).toHaveLength(0);
    expect(requests('DELETE', /photo$/)).toHaveLength(0);
  });

  it('requires a first name and a plausible birth weight, and sends nothing until fixed', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Levon' }));
    await user.clear(screen.getByLabelText('First name'));
    await user.type(screen.getByLabelText(/Birth weight/), '34');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please enter a name.')).toBeDefined();
    expect(screen.getByText(/Enter a birth weight between/)).toBeDefined();
    expect(requests('PATCH', /babies/)).toHaveLength(0);
  });

  it('replaces the photo with a shrunk image', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Ani' }));
    await user.upload(
      screen.getByLabelText('Choose a profile photo'),
      new File(['x'], 'baby.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(requests('PUT', /\/babies\/b-ani\/photo$/)).toHaveLength(1);
    });
    const call = requests('PUT', /photo$/)[0] ?? [];
    expect(new Headers((call[1] as RequestInit).headers).get('Content-Type')).toBe('image/jpeg');
    expect((call[1] as RequestInit).body).toBeInstanceOf(Blob);
  });

  it('removes the photo only when asked', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit Ani' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(requests('DELETE', /\/babies\/b-ani\/photo$/)).toHaveLength(1);
    });
  });

  it('refuses a file that is not an allowed image type', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup({ applyAccept: false });

    await user.click(await screen.findByRole('button', { name: 'Edit Levon' }));
    await user.upload(
      screen.getByLabelText('Choose a profile photo'),
      new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
    );

    expect(await screen.findByText('Choose a JPEG, PNG or WebP image.')).toBeDefined();
  });
});

describe('adding a child', () => {
  it('needs only a name, and sends only what was filled in', async () => {
    stubApi();
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add a child' }));
    await user.type(screen.getByLabelText('First name'), 'Mia');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(requests('POST', /\/babies$/)).toHaveLength(1);
    });
    expect(bodyOf(requests('POST', /\/babies$/)[0] ?? [])).toEqual({ name: 'Mia' });
    expect(requests('PUT', /photo$/)).toHaveLength(0);
  });
});
