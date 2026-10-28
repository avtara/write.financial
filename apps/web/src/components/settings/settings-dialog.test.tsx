// SPDX-License-Identifier: AGPL-3.0-only
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import type { AiSettingsView } from '@wf/domain/ai';
import { setLocale } from '@wf/i18n/runtime';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import * as z from 'zod';
import { fakeAuthActions, VIEWER } from '../../../test/fake-auth.ts';
import { DEFAULT_PREFERENCES } from '../../../test/render.tsx';
import type { SecurityOverview } from '../../server/account.ts';
import type { Viewer } from '../../server/gate.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { PreferencesProvider } from '../preferences.tsx';
import { ShortcutProvider } from '../shortcuts.tsx';
import { loadSettingsSection, SettingsDialog, type SettingsData } from './settings-dialog.tsx';
import { openSettings, SETTINGS_SECTIONS } from './settings-sections.ts';

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
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listSimilarTags: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ledger);
const rulesServer = vi.hoisted(() => ({
  listAutoRules: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  listRuleSuggestions: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  createAutoRule: vi.fn(),
  updateAutoRule: vi.fn(),
  deleteAutoRule: vi.fn(),
  setAutoRuleEnabled: vi.fn(),
  reorderAutoRules: vi.fn(),
  dismissRuleSuggestion: vi.fn(),
  previewAutoRule: vi.fn(),
  requestRuleBackfill: vi.fn(),
  getRuleBackfillResult: vi.fn(),
  applyRuleBackfill: vi.fn(),
}));
vi.mock('../../server/fn/rules.ts', () => rulesServer);
vi.mock('../../server/fn/tags.ts', () => ({ listSimilarTags: ledger.listSimilarTags }));
const budget = vi.hoisted(() => ({ getPeriodSettings: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => budget);
vi.mock('./period-section.tsx', () => ({
  PeriodSection: ({ payday }: { payday: { day: number } }) => <p>{`gajian tgl ${String(payday.day)}`}</p>,
}));
vi.mock('./categories-section.tsx', () => ({
  CategoriesSection: ({ categories }: { categories: unknown[] }) => <p>{`${String(categories.length)} kategori`}</p>,
}));
vi.mock('./tags-section.tsx', () => ({
  TagsSection: ({ tags, similar }: { tags: unknown[]; similar: unknown[] }) => (
    <p>{`${String(tags.length)} tag, ${String(similar.length)} mirip`}</p>
  ),
}));
vi.mock('./instance-section.tsx', () => ({
  InstanceSection: () => <p>instance form</p>,
}));
const ai = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  removeAiKey: vi.fn(),
  listAiModels: vi.fn(),
  testAiConnection: vi.fn(),
  listAiLogs: vi.fn(),
  exportAiLogs: vi.fn(),
}));
vi.mock('../../server/fn/ai.ts', () => ai);
const market = vi.hoisted(() => ({ getMarketSettings: vi.fn() }));
vi.mock('../../server/fn/market.ts', () => market);
vi.mock('./market-section.tsx', () => ({
  MarketSection: ({ timeZone }: { timeZone: string }) => <p>{`pasar di ${timeZone}`}</p>,
}));
const gmail = vi.hoisted(() => ({ getGmailSettings: vi.fn() }));
vi.mock('../../server/fn/gmail.ts', () => gmail);
vi.mock('./gmail-section.tsx', () => ({
  GmailSection: ({ settings }: { settings: { connection: unknown } }) => (
    <p>{`gmail ${settings.connection === null ? 'kosong' : 'terhubung'}`}</p>
  ),
}));
const notifications = vi.hoisted(() => ({ getNotificationSettings: vi.fn() }));
vi.mock('../../server/fn/notifications.ts', () => notifications);
const data = vi.hoisted(() => ({
  getDataSettings: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
  exportMyData: vi.fn(),
}));
vi.mock('../../server/fn/data.ts', () => data);
vi.mock('./notifications-section.tsx', () => ({
  NotificationsSection: ({ email }: { email: string }) => <p>{`notifikasi ke ${email}`}</p>,
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
const AI_SETTINGS: AiSettingsView = {
  revision: null,
  twoFactorEnabled: false,
  provider: 'openrouter',
  connections: [],
  allowReadFinancial: false,
  allowCreateDrafts: false,
  requireConfirmation: true,
  monthlyLimitUsd: '5',
  usage: { month: '2026-10', requests: 0, spentUsd: '0', estimatedUsd: '0', reservedUsd: '0', limitUsd: '5' },
  allowedCustomBaseUrls: [],
};

/**
 * The app's layout in small: `?settings=` loads the section like the `_app` loader and shows the dialog over the
 * page, which has a button opening "Keamanan" the way the user menu and ⌘K do.
 */
async function renderSettings(path: string, viewer: Viewer = VIEWER, locale: 'id' | 'en' = 'id') {
  await setLocale(locale, { reload: false });
  const root = createRootRoute({
    validateSearch: z.object({ settings: z.enum(SETTINGS_SECTIONS).optional().catch(undefined) }),
    loaderDeps: ({ search }) => ({ settings: search.settings }),
    loader: ({ deps }) => (deps.settings === undefined ? null : loadSettingsSection(deps.settings)),
  });
  function Layout() {
    // The hook is typed by the app's registered root route; this test root loads the Settings section instead.
    const data = root.useLoaderData() as unknown as SettingsData | null;
    const navigate = useNavigate();
    return (
      <PreferencesProvider initial={{ ...DEFAULT_PREFERENCES, locale }}>
        <ShortcutProvider platform="mac">
          <AuthActionsProvider actions={fakeAuthActions()}>
            <button type="button" onClick={() => void navigate(openSettings('security'))}>
              buka keamanan
            </button>
            <Outlet />
            <SettingsDialog viewer={viewer} data={data} />
          </AuthActionsProvider>
        </ShortcutProvider>
      </PreferencesProvider>
    );
  }
  root.update({ component: Layout });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Ringkasan</h1> }),
      createRoute({ getParentRoute: () => root, path: '/other', component: () => <h1>Lain</h1> }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  await render(<RouterProvider router={router} />);
  return router;
}

describe('loadSettingsSection', () => {
  it('loads the profile with the sign-in methods, the security overview, or nothing for the instance', async () => {
    server.getProfile.mockResolvedValue({ ok: true, value: PROFILE });
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    const security = { ok: true, value: OVERVIEW };
    await expect(loadSettingsSection('profile')).resolves.toEqual({
      section: 'profile',
      profile: { ok: true, value: PROFILE },
      security,
    });
    await expect(loadSettingsSection('security')).resolves.toEqual({ section: 'security', security });
    await expect(loadSettingsSection('instance')).resolves.toEqual({ section: 'instance' });
  });

  it('loads every category (archived too) or the tags with their similar pairs', async () => {
    ledger.listCategories.mockResolvedValue({ ok: true, value: [] });
    ledger.listTags.mockResolvedValue({ ok: true, value: [] });
    ledger.listSimilarTags.mockResolvedValue({ ok: true, value: [] });
    await expect(loadSettingsSection('categories')).resolves.toEqual({
      section: 'categories',
      categories: { ok: true, value: [] },
    });
    expect(ledger.listCategories).toHaveBeenCalledWith({ data: { includeArchived: true } });
    await expect(loadSettingsSection('tags')).resolves.toEqual({
      section: 'tags',
      tags: { ok: true, value: [] },
      similar: { ok: true, value: [] },
    });
  });

  it('loads the rules with their suggestions, categories, tags, and accounts', async () => {
    ledger.listCategories.mockResolvedValue({ ok: true, value: [] });
    ledger.listTags.mockResolvedValue({ ok: true, value: [] });
    rulesServer.listAutoRules.mockResolvedValue({ ok: true, value: [] });
    rulesServer.listRuleSuggestions.mockResolvedValue({ ok: true, value: [] });
    ledger.listAccounts.mockResolvedValue({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n },
    });
    await expect(loadSettingsSection('rules')).resolves.toEqual({
      section: 'rules',
      rules: { ok: true, value: [] },
      suggestions: { ok: true, value: [] },
      categories: { ok: true, value: [] },
      tags: { ok: true, value: [] },
      accounts: { ok: true, value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n } },
    });
    expect(ledger.listCategories).toHaveBeenCalledWith({ data: { includeArchived: true } });
    expect(ledger.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
  });

  it('loads the period and the notification settings', async () => {
    budget.getPeriodSettings.mockResolvedValue({ ok: true, value: { overview: {}, payday: {} } });
    await expect(loadSettingsSection('period')).resolves.toEqual({
      section: 'period',
      period: { ok: true, value: { overview: {}, payday: {} } },
    });
    notifications.getNotificationSettings.mockResolvedValue({ ok: true, value: { email: true } });
    data.getDataSettings.mockResolvedValue({ ok: true, value: { deletionRequestedAt: null, deleteAfter: null } });
    await expect(loadSettingsSection('notifications')).resolves.toEqual({
      section: 'notifications',
      notifications: { ok: true, value: { email: true } },
    });
    market.getMarketSettings.mockResolvedValue({ ok: true, value: { keys: [] } });
    await expect(loadSettingsSection('market')).resolves.toEqual({
      section: 'market',
      market: { ok: true, value: { keys: [] } },
    });
    gmail.getGmailSettings.mockResolvedValue({ ok: true, value: { connection: null } });
    await expect(loadSettingsSection('gmail')).resolves.toEqual({
      section: 'gmail',
      gmail: { ok: true, value: { connection: null } },
    });
  });
});

describe('SettingsDialog', () => {
  it('is closed without a section', async () => {
    await renderSettings('/');
    await expect.element(page.getByRole('heading', { name: 'Ringkasan' })).toBeVisible();
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
  });

  it('shows the header, the sections a user may open, and Profil & akun, starting on its link', async () => {
    server.getProfile.mockResolvedValue({ ok: true, value: PROFILE });
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    await renderSettings('/?settings=profile');
    const dialog = page.getByRole('dialog', { name: 'Pengaturan' });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(
        'Akun, mata uang & kurs, tampilan, notifikasi, dan data — tersinkron di semua perangkat.',
      );
    const nav = dialog.getByRole('navigation', { name: 'Bagian pengaturan' });
    expect(nav.element().textContent).toBe(
      'AkunProfil & akunPreferensiPeriode bulananNotifikasiKategoriTagAturan otomatisPrivasiDataKeamananIntegrasiAI agent (BYOK)API kurs & pasarGmail',
    );
    const profile = nav.getByRole('link', { name: 'Profil & akun' });
    await expect.element(profile).toHaveAttribute('href', '/?settings=profile');
    await expect.element(profile).toHaveAttribute('aria-current', 'page');
    await expect.element(profile).toHaveFocus();
    await expect.element(nav.getByRole('link', { name: 'Tag' })).toHaveAttribute('href', '/?settings=tags');
    await expect.element(nav.getByRole('link', { name: 'Gmail' })).toHaveAttribute('href', '/?settings=gmail');
    await expect.element(dialog.getByRole('region', { name: 'Profil & akun' })).toBeVisible();
    await expect.element(dialog.getByRole('textbox', { name: 'Nama lengkap' })).toHaveValue('Avtara K.');
  });

  it('shows Settings › Aturan otomatis', async () => {
    ledger.listCategories.mockResolvedValue({ ok: true, value: [] });
    ledger.listTags.mockResolvedValue({ ok: true, value: [] });
    rulesServer.listAutoRules.mockResolvedValue({ ok: true, value: [] });
    rulesServer.listRuleSuggestions.mockResolvedValue({ ok: true, value: [] });
    ledger.listAccounts.mockResolvedValue({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n },
    });
    await renderSettings('/?settings=rules');
    const dialog = page.getByRole('dialog', { name: 'Pengaturan' });
    await expect.element(dialog.getByRole('heading', { name: 'Aturan otomatis' })).toBeVisible();
    await expect
      .element(dialog.getByText('Belum ada aturan. Tambahkan satu, atau mulai dari saran koreksimu.'))
      .toBeVisible();
  });

  it('lists "Instans" for admins and shows the instance settings', async () => {
    await renderSettings('/?settings=instance', { ...VIEWER, role: 'admin' }, 'en');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const nav = dialog.getByRole('navigation', { name: 'Settings sections' });
    await expect.element(nav.getByRole('heading', { name: 'Instance' })).toBeVisible();
    await expect.element(nav.getByRole('link', { name: 'Instance' })).toHaveAttribute('href', '/?settings=instance');
    await expect.element(dialog.getByRole('region', { name: 'Instance' })).toBeVisible();
    await expect.element(dialog.getByText('instance form')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Close settings' })).toBeVisible();
  });

  it('opens over the page; switching sections replaces the entry and Escape goes back to the page', async () => {
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    server.getProfile.mockResolvedValue({ ok: true, value: PROFILE });
    const router = await renderSettings('/other');
    const opener = page.getByRole('button', { name: 'buka keamanan' });
    await userEvent.click(opener);
    const dialog = page.getByRole('dialog', { name: 'Pengaturan' });
    await expect.element(dialog.getByRole('region', { name: 'Verifikasi dua langkah' })).toBeVisible();
    expect(router.state.location.href).toBe('/other?settings=security');
    await userEvent.click(dialog.getByRole('link', { name: 'Profil & akun' }));
    await expect.element(dialog.getByRole('region', { name: 'Profil & akun' })).toBeVisible();
    expect(router.state.location.href).toBe('/other?settings=profile');
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/other');
    });
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await expect.element(opener).toHaveFocus();
    expect(router.history.canGoBack()).toBe(false);
  });

  it('opened by a link from elsewhere, × closes it on the same page', async () => {
    server.getSecurity.mockResolvedValue({ ok: true, value: OVERVIEW });
    const router = await renderSettings('/?settings=security');
    await userEvent.click(page.getByRole('button', { name: 'Tutup pengaturan' }));
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/');
    });
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await expect.element(page.getByRole('heading', { name: 'Ringkasan' })).toBeVisible();
    expect(router.history.canGoBack()).toBe(false);
  });

  it('renders Kategori and Tag, or why they could not be loaded', async () => {
    ledger.listCategories.mockResolvedValueOnce({ ok: true, value: [{}, {}] });
    await renderSettings('/?settings=categories');
    await expect.element(page.getByText('2 kategori')).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Kategori' })).toBeVisible();

    ledger.listCategories.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await renderSettings('/?settings=categories');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');

    ledger.listTags.mockResolvedValue({ ok: true, value: [{}] });
    ledger.listSimilarTags.mockResolvedValueOnce({ ok: true, value: [{}, {}] });
    await renderSettings('/?settings=tags');
    await expect.element(page.getByText('1 tag, 2 mirip')).toBeVisible();

    ledger.listSimilarTags.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await renderSettings('/?settings=tags');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');

    ledger.listTags.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    ledger.listSimilarTags.mockResolvedValueOnce({ ok: true, value: [] });
    await renderSettings('/?settings=tags');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
  });

  it('renders Periode bulanan, or why it could not be loaded', async () => {
    budget.getPeriodSettings.mockResolvedValueOnce({ ok: true, value: { overview: {}, payday: { day: 1 } } });
    await renderSettings('/?settings=period');
    await expect.element(page.getByText('gajian tgl 1')).toBeVisible();
    await expect.element(page.getByRole('region', { name: 'Periode bulanan' })).toBeVisible();

    budget.getPeriodSettings.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await renderSettings('/?settings=period');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');
  });

  it('renders Notifikasi with the address emails go to, or why it could not be loaded', async () => {
    notifications.getNotificationSettings.mockResolvedValueOnce({ ok: true, value: { email: true } });
    await renderSettings('/?settings=notifications');
    await expect.element(page.getByText(`notifikasi ke ${VIEWER.email}`)).toBeVisible();
    notifications.getNotificationSettings.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await renderSettings('/?settings=notifications');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
  });

  it('renders API kurs & pasar in the viewer’s time zone, or why it could not be loaded', async () => {
    market.getMarketSettings.mockResolvedValueOnce({ ok: true, value: { keys: [] } });
    await renderSettings('/?settings=market');
    await expect.element(page.getByText(`pasar di ${VIEWER.timezone}`)).toBeVisible();
    market.getMarketSettings.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await renderSettings('/?settings=market');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
  });

  it('closes to the underlying page after following the AI security prerequisite', async () => {
    ai.getAiSettings.mockResolvedValue({ ok: true, value: AI_SETTINGS });
    server.getSecurity.mockResolvedValue({ ok: true, value: { ...OVERVIEW, twoFactorEnabled: false } });
    const router = await renderSettings('/?settings=ai');
    await page.getByRole('button', { name: 'Buka Keamanan' }).click();
    await expect.element(page.getByRole('region', { name: 'Verifikasi dua langkah' })).toBeVisible();
    await page.getByRole('button', { name: 'Tutup pengaturan' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/');
    });
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await expect.element(page.getByRole('heading', { name: 'Ringkasan' })).toBeVisible();
  });

  it('explains when the security overview or the profile could not be loaded', async () => {
    server.getSecurity.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await renderSettings('/?settings=security');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');

    server.getProfile.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    server.getSecurity.mockResolvedValueOnce({ ok: true, value: OVERVIEW });
    await renderSettings('/?settings=profile');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
  });

  it('renders Gmail, Data, and AI agent, or why each could not be loaded', async () => {
    gmail.getGmailSettings.mockResolvedValueOnce({ ok: true, value: { connection: null } });
    await renderSettings('/?settings=gmail');
    await expect.element(page.getByText('gmail kosong')).toBeVisible();
    gmail.getGmailSettings.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await renderSettings('/?settings=gmail');
    await expect
      .element(page.getByRole('alert').last())
      .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');

    data.getDataSettings.mockResolvedValueOnce({ ok: true, value: { deletionRequestedAt: null, deleteAfter: null } });
    await renderSettings('/?settings=data');
    await expect.element(page.getByRole('button', { name: 'Hapus akun' }).last()).toBeVisible();
    data.getDataSettings.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await renderSettings('/?settings=data');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');

    ai.getAiSettings.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await renderSettings('/?settings=ai');
    await expect.element(page.getByRole('alert').last()).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');
  });

  it('refuses to show Aturan otomatis with any of its inputs missing', async () => {
    ledger.listCategories.mockResolvedValue({ ok: true, value: [] });
    ledger.listTags.mockResolvedValue({ ok: true, value: [] });
    ledger.listAccounts.mockResolvedValue({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n },
    });
    const failures = [
      () => rulesServer.listAutoRules.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' } as never),
      () => rulesServer.listRuleSuggestions.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' } as never),
      () => ledger.listCategories.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' }),
      () => ledger.listTags.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' }),
      () => ledger.listAccounts.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' }),
    ];
    for (const fail of failures) {
      fail();
      await renderSettings('/?settings=rules');
      const dialog = page.getByRole('dialog', { name: 'Pengaturan' }).last();
      await expect
        .element(dialog.getByRole('alert'))
        .toHaveTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
    }
  });
});
