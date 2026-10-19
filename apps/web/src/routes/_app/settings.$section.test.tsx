// SPDX-License-Identifier: AGPL-3.0-only
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  isNotFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { setLocale } from '@wf/i18n/runtime';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { fakeAuthActions, VIEWER } from '../../../test/fake-auth.ts';
import { DEFAULT_PREFERENCES } from '../../../test/render.tsx';
import { AuthActionsProvider } from '../../components/auth-actions.tsx';
import { PreferencesProvider } from '../../components/preferences.tsx';
import { ShortcutProvider } from '../../components/shortcuts.tsx';
import type { SecurityOverview } from '../../server/account.ts';
import type { Viewer } from '../../server/gate.ts';
import { Route } from './settings.$section.tsx';

const server = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getSecurity: vi.fn(),
  updateProfile: vi.fn(),
  revokeDevice: vi.fn(),
  revokeOtherDevices: vi.fn(),
  getSecurityHistory: vi.fn(),
}));
vi.mock('../../server/fn/account.ts', () => server);
const ledger = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listSimilarTags: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ledger);
vi.mock('../../server/fn/tags.ts', () => ({ listSimilarTags: ledger.listSimilarTags }));
vi.mock('../../components/settings/categories-section.tsx', () => ({
  CategoriesSection: ({ categories }: { categories: unknown[] }) => <p>{`${String(categories.length)} kategori`}</p>,
}));
vi.mock('../../components/settings/tags-section.tsx', () => ({
  TagsSection: ({ tags, similar }: { tags: unknown[]; similar: unknown[] }) => (
    <p>{`${String(tags.length)} tag, ${String(similar.length)} mirip`}</p>
  ),
}));
vi.mock('../../components/settings/instance-section.tsx', () => ({
  InstanceSection: () => <p>instance form</p>,
}));

const PROFILE = { name: 'Avtara K.', nickname: null, locale: 'id', timezone: 'Asia/Jakarta' };
const OVERVIEW: SecurityOverview = {
  twoFactorEnabled: true,
  hasPassword: true,
  googleLinked: true,
  passkeys: [],
  devices: [],
  history: { events: [], nextBefore: null },
};

type Loader = (options: { params: { section: string }; context: { viewer: Viewer } }) => Promise<unknown>;
const loader = Route.options.loader as unknown as Loader;

async function openSettings(section: string, viewer: Viewer = VIEWER) {
  await setLocale('id', { reload: false });
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider initial={DEFAULT_PREFERENCES}>
        <ShortcutProvider platform="mac">
          <AuthActionsProvider actions={fakeAuthActions()}>
            <Outlet />
          </AuthActionsProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    ),
  });
  const app = createRoute({ getParentRoute: () => root, id: '_app', beforeLoad: () => ({ viewer }) });
  Route.update({ id: '/_app/settings/$section', path: '/settings/$section', getParentRoute: () => app } as never);
  const router = createRouter({
    routeTree: root.addChildren([app.addChildren([Route as never])]),
    history: createMemoryHistory({ initialEntries: [`/settings/${section}`] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);
  return router;
}

describe('/settings/$section loader', () => {
  it('loads the profile with the sign-in methods, the security overview, or nothing for the instance', async () => {
    server.getProfile.mockResolvedValue({ ok: true, value: PROFILE });
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    const security = { ok: true, value: OVERVIEW };
    await expect(loader({ params: { section: 'profile' }, context: { viewer: VIEWER } })).resolves.toEqual({
      section: 'profile',
      profile: { ok: true, value: PROFILE },
      security,
    });
    await expect(loader({ params: { section: 'security' }, context: { viewer: VIEWER } })).resolves.toEqual({
      section: 'security',
      security,
    });
    await expect(
      loader({ params: { section: 'instance' }, context: { viewer: { ...VIEWER, role: 'admin' } } }),
    ).resolves.toEqual({ section: 'instance' });
  });

  it('loads every category (archived too) or the tags with their similar pairs', async () => {
    ledger.listCategories.mockResolvedValue({ ok: true, value: [] });
    ledger.listTags.mockResolvedValue({ ok: true, value: [] });
    ledger.listSimilarTags.mockResolvedValue({ ok: true, value: [] });
    await expect(loader({ params: { section: 'categories' }, context: { viewer: VIEWER } })).resolves.toEqual({
      section: 'categories',
      categories: { ok: true, value: [] },
    });
    expect(ledger.listCategories).toHaveBeenCalledWith({ data: { includeArchived: true } });
    await expect(loader({ params: { section: 'tags' }, context: { viewer: VIEWER } })).resolves.toEqual({
      section: 'tags',
      tags: { ok: true, value: [] },
      similar: { ok: true, value: [] },
    });
  });

  it('answers 404 for unknown sections and for "instance" to non-admins', async () => {
    for (const section of ['billing', 'instance']) {
      const error: unknown = await loader({ params: { section }, context: { viewer: VIEWER } }).catch(
        (thrown: unknown) => thrown,
      );
      expect(isNotFound(error)).toBe(true);
    }
  });

  it('titles the page', () => {
    expect(Route.options.head?.({} as never)).toEqual({ meta: [{ title: 'Pengaturan · write.financial' }] });
  });
});

describe('/settings/$section page', () => {
  it('renders Profil & akun in the settings layout', async () => {
    server.getProfile.mockResolvedValue({ ok: true, value: PROFILE });
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    await openSettings('profile');
    await expect.element(page.getByRole('heading', { level: 1, name: 'Pengaturan' })).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Profil & akun' })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Nama lengkap' })).toHaveValue('Avtara K.');
  });

  it('renders Keamanan', async () => {
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    await openSettings('security');
    await expect.element(page.getByRole('region', { name: 'Verifikasi dua langkah' })).toBeVisible();
  });

  it('renders the instance settings for admins', async () => {
    await openSettings('instance', { ...VIEWER, role: 'admin' });
    await expect.element(page.getByText('instance form')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Instans' })).toBeVisible();
  });

  it('renders Kategori and Tag, or why they could not be loaded', async () => {
    ledger.listCategories.mockResolvedValueOnce({ ok: true, value: [{}, {}] });
    await openSettings('categories');
    await expect.element(page.getByText('2 kategori')).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Kategori' })).toBeVisible();

    ledger.listCategories.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await openSettings('categories');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');

    ledger.listTags.mockResolvedValue({ ok: true, value: [{}] });
    ledger.listSimilarTags.mockResolvedValueOnce({ ok: true, value: [{}, {}] });
    await openSettings('tags');
    await expect.element(page.getByText('1 tag, 2 mirip')).toBeVisible();

    ledger.listSimilarTags.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await openSettings('tags');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');

    ledger.listTags.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    ledger.listSimilarTags.mockResolvedValueOnce({ ok: true, value: [] });
    await openSettings('tags');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
  });

  it('explains when the section could not be loaded', async () => {
    server.getSecurity.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    await openSettings('security');
    await expect.element(page.getByRole('alert')).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');
  });

  it('explains when the profile could not be loaded', async () => {
    server.getProfile.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    await openSettings('profile');
    await expect.element(page.getByRole('alert')).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
  });
});
