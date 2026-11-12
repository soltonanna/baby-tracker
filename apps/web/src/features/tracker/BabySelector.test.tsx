import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Baby } from '@baby-tracker/shared';
import { resetSession } from '../../services/session.js';
import { resetRefreshState } from '../../services/apiClient.js';
import { BabySelector } from './BabySelector.js';

const baby = (id: string, name: string, extra: Partial<Baby> = {}): Baby => ({
  id,
  familyId: 'f1',
  name,
  createdAt: '2026-06-01T09:00:00.000Z',
  updatedAt: '2026-06-01T09:00:00.000Z',
  ...extra,
});

const withPhoto = baby('b1', 'Ani', { hasPhoto: true, photoUpdatedAt: '2026-06-02T00:00:00.000Z' });
const withoutPhoto = baby('b2', 'Levon');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSession();
  resetRefreshState();
  URL.createObjectURL = vi.fn(() => 'blob:ani');
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response('img', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSelector(familyId?: string): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BabySelector
        babies={[withPhoto, withoutPhoto]}
        selectedBabyId="b1"
        onSelect={() => undefined}
        familyId={familyId}
      />
    </QueryClientProvider>,
  );
}

describe('BabySelector circle', () => {
  it('shows the photo instead of the initial for a baby who has one, and the initial for the other', async () => {
    renderSelector('f1');

    await waitFor(() => {
      expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:ani');
    });
    const [ani, levon] = screen.getAllByRole('tab');
    expect(ani?.textContent).toBe('Ani');
    expect(levon?.textContent).toBe('LLevon');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the initial when no family is given', () => {
    renderSelector();
    expect(document.querySelector('img')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
