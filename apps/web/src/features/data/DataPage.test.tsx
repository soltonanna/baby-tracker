import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilyDataExport, FamilyWithRole } from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { DataPage } from './DataPage.js';

/** The data screen through its real query layer, with only `fetch` replaced. */

const family = (role: FamilyWithRole['role'] = 'OWNER'): FamilyWithRole => ({
  id: 'family-1',
  name: 'Sultanova',
  createdBy: 'user-1',
  role,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
});

const exported: FamilyDataExport = {
  format: 'baby-tracker/family-data',
  version: 1,
  exportedAt: '2026-10-08T10:00:00.000Z',
  babies: [
    {
      id: 'b1',
      name: 'Ani',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
  ],
  events: [],
  measurements: [],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function stubApi(role: FamilyWithRole['role'] = 'OWNER'): void {
  fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost').pathname;
    const method = init?.method ?? 'GET';
    if (url.endsWith('/data/export')) return Promise.resolve(json(exported));
    if (url.endsWith('/data/import') && method === 'POST')
      return Promise.resolve(json({ imported: { babies: 2, events: 5, measurements: 1 } }));
    if (url.endsWith('/data') && method === 'DELETE')
      return Promise.resolve(json({ deleted: { babies: 2, events: 9, measurements: 3 } }));
    if (url.endsWith('/families')) return Promise.resolve(json({ families: [family(role)] }));
    throw new Error(`Unexpected request in test: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(
    (call) =>
      ((call[1] as RequestInit | undefined)?.method ?? 'GET') === method &&
      pattern.test(String(call[0])),
  );

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DataPage />
    </QueryClientProvider>,
  );
}

const file = (contents: string, name = 'backup.json'): File =>
  new File([contents], name, { type: 'application/json' });

beforeEach(() => {
  resetSession();
  resetRefreshState();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataPage', () => {
  it('downloads an export and says what was in it', async () => {
    stubApi();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Download backup' }));

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Downloaded: Babies: 1 · Events: 0 · Measurements: 0.',
    );
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('refuses a file that is not a data file, without calling the API', async () => {
    stubApi();
    renderPage();

    await userEvent.upload(await screen.findByLabelText('Choose a file…'), file('{"hello":1}'));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This is not a Baby Tracker data file, or it is damaged.',
    );
    expect(calls('POST', /\/data\/import$/)).toHaveLength(0);
  });

  it('shows what a file holds and imports only after confirmation', async () => {
    stubApi();
    renderPage();

    await userEvent.upload(
      await screen.findByLabelText('Choose a file…'),
      file(JSON.stringify(exported)),
    );
    expect(await screen.findByText('Babies: 1 · Events: 0 · Measurements: 0')).toBeDefined();
    expect(calls('POST', /\/data\/import$/)).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Replace data' }));

    expect(
      await screen.findByText('Imported: Babies: 2 · Events: 5 · Measurements: 1.'),
    ).toBeDefined();
    const [call] = calls('POST', /\/data\/import$/);
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual(exported);
  });

  it('clears only after confirmation, and can be cancelled', async () => {
    stubApi();
    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: "Clear all children's data…" }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls('DELETE', /\/data$/)).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: "Clear all children's data…" }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(
      await screen.findByText('Deleted: Babies: 2 · Events: 9 · Measurements: 3.'),
    ).toBeDefined();
    expect(calls('DELETE', /\/data$/)).toHaveLength(1);
  });

  it('offers a member export only', async () => {
    stubApi('MEMBER');
    renderPage();

    expect(await screen.findByRole('button', { name: 'Download backup' })).toBeDefined();
    expect(screen.getByText('Only the family owner can import or clear data.')).toBeDefined();
    expect(screen.queryByLabelText('Choose a file…')).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear all/ })).toBeNull();
  });
});
