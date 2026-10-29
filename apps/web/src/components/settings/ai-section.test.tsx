// SPDX-License-Identifier: AGPL-3.0-only
import type { AiConnectionView, AiLogView, AiModelCatalog, AiPricing, AiSettingsView } from '@wf/domain/ai';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import * as z from 'zod';
import { VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import { AiSection } from './ai-section.tsx';

const server = vi.hoisted(() => ({
  exportAiLogs: vi.fn(),
  listAiLogs: vi.fn(),
  listAiModels: vi.fn(),
  removeAiKey: vi.fn(),
  saveAiSettings: vi.fn(),
  testAiConnection: vi.fn(),
}));
vi.mock('../../server/fn/ai.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);
const reauth = vi.hoisted(() => ({ reauthenticate: vi.fn() }));
vi.mock('./reauth.tsx', () => ({
  useReauthentication: () => ({ reauthenticate: reauth.reauthenticate, dialog: null }),
}));

const TZ = 'Asia/Jakarta';
const NOW = new Date('2026-10-15T09:30:00Z');
const LATER = new Date('2026-10-16T03:00:00Z');
const PRICING: AiPricing = {
  inputUsdPerMillion: '3',
  outputUsdPerMillion: '15',
  requestUsd: '0',
  imageUsd: '0',
};

const connection = (overrides: Partial<AiConnectionView> = {}): AiConnectionView => ({
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  last4: '3f9a',
  status: 'connected',
  modelId: 'anthropic/claude-sonnet-5.5',
  addedAt: new Date('2026-10-02T04:00:00Z'),
  testedAt: NOW,
  errorCode: null,
  httpStatus: null,
  pricing: PRICING,
  pricingSource: 'catalog',
  ...overrides,
});

const baseView = (overrides: Partial<AiSettingsView> = {}): AiSettingsView => ({
  revision: 'rev-1',
  twoFactorEnabled: true,
  provider: 'openrouter',
  connections: [connection()],
  allowReadFinancial: true,
  allowCreateDrafts: false,
  requireConfirmation: true,
  monthlyLimitUsd: '5.00',
  usage: {
    month: '2026-10',
    requests: 312,
    spentUsd: '1.24',
    estimatedUsd: '0.02',
    reservedUsd: '0.0004',
    limitUsd: '5.00',
  },
  allowedCustomBaseUrls: ['https://api.example.test/v1'],
  ...overrides,
});

const CATALOG: AiModelCatalog = {
  provider: 'openrouter',
  loadedAt: NOW,
  catalogPublic: true,
  models: [
    {
      id: 'anthropic/claude-sonnet-5.5',
      name: 'Claude Sonnet 5.5',
      contextLength: 200_000,
      maxOutputTokens: 8_192,
      pricing: PRICING,
    },
    {
      id: 'meta/llama-free',
      name: 'Llama Free',
      contextLength: null,
      maxOutputTokens: null,
      pricing: null,
    },
  ],
};

const logView = (overrides: Partial<AiLogView> & { id: string }): AiLogView => ({
  createdAt: NOW,
  provider: 'openrouter',
  feature: 'chat',
  modelId: 'anthropic/claude-sonnet-5.5',
  status: 'ok',
  httpStatus: 200,
  inputTokens: 3_400,
  outputTokens: 410,
  costUsd: '0.016',
  costSource: 'reported',
  durationMs: 640,
  dataSent: { images: 0, categories: 1, accounts: 2, transactions: 14 },
  toolCalls: ['buat_transaksi_draft'],
  errorCode: null,
  ...overrides,
});

const render = (settings: AiSettingsView = baseView(), locale: 'id' | 'en' = 'id') =>
  renderApp(<AiSection settings={settings} viewer={VIEWER} timeZone={TZ} />, { preferences: { locale } });

const keyInput = () => page.getByLabelText('API key');
const limitInput = () => page.getByLabelText('Batas bulanan (USD)');
const saveButton = () => page.getByRole('button', { name: 'Simpan perubahan' });
const testButton = () => page.getByRole('region', { name: 'Tes' }).getByRole('button');
const logButton = () => page.getByRole('button', { name: 'Lihat log' });
const costRegion = () => page.getByRole('region', { name: 'Batas biaya & pemakaian' });

beforeEach(() => {
  vi.clearAllMocks();
  server.exportAiLogs.mockReset();
  server.listAiLogs.mockReset();
  server.listAiModels.mockReset();
  server.removeAiKey.mockReset();
  server.saveAiSettings.mockReset();
  server.testAiConnection.mockReset();
  reauth.reauthenticate.mockReset();
  reauth.reauthenticate.mockResolvedValue(true);
  server.listAiLogs.mockResolvedValue({ ok: true, value: { total: 0, failed: 0, items: [] } });
});

describe('AiSection', () => {
  it('uses refreshed two-factor authorization without discarding unsaved edits', async () => {
    function SecurityRefresh() {
      const [enabled, setEnabled] = useState(false);
      return (
        <>
          <button
            onClick={() => {
              setEnabled((current) => !current);
            }}
          >
            Refresh security
          </button>
          <AiSection settings={baseView({ twoFactorEnabled: enabled })} viewer={VIEWER} timeZone={TZ} />
        </>
      );
    }
    await renderApp(<SecurityRefresh />);
    await expect.element(testButton()).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh security' }).click();
    await expect.element(testButton()).toBeEnabled();
    await keyInput().fill('replacement-key');
    await expect.element(saveButton()).toBeEnabled();
    await page.getByRole('button', { name: 'Refresh security' }).click();
    await expect.element(saveButton()).toBeDisabled();
    await expect.element(keyInput()).toHaveValue('replacement-key');
  });

  it('shows the saved connection without ever repopulating its key', async () => {
    await render();
    await expect.element(page.getByRole('button', { name: /OpenRouter/ })).toHaveAttribute('aria-pressed', 'true');
    const connectionRegion = page.getByRole('region', { name: 'Koneksi OpenRouter' });
    await expect.element(connectionRegion.getByText(/3f9a · terenkripsi/)).toBeVisible();
    await expect.element(connectionRegion.getByText(/Terhubung/)).toBeVisible();
    await expect.element(connectionRegion.getByText(/Ditambahkan 2 Okt 2026/)).toBeVisible();
    await expect.element(keyInput()).toHaveValue('');
    await expect.element(testButton()).toBeEnabled();
    await expect.element(saveButton()).toBeDisabled();
  });

  it('shows the unconnected server default as no key', async () => {
    await render(baseView({ revision: 'rev-1', connections: [] }));
    await expect.element(page.getByText('Belum terhubung').first()).toBeVisible();
    await expect.element(page.getByText('Belum ada key')).toBeVisible();
    await expect.element(testButton()).toBeDisabled();
    await expect.element(page.getByText('Simpan key dan model dulu sebelum menguji.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Hapus key' }).elements()).toHaveLength(0);
  });

  it('asks to save first when there is no revision to test', async () => {
    await render(baseView({ revision: null, connections: [] }));
    await expect.element(page.getByText('Simpan konfigurasi dulu sebelum menguji.')).toBeVisible();
    await expect.element(testButton()).toBeDisabled();
  });

  it('keeps edits when saving fails and resets them with Cancel', async () => {
    server.saveAiSettings.mockResolvedValueOnce({ ok: false, code: 'AI_CONFIG_CHANGED' });
    await render();
    await keyInput().fill('sk-or-v1-new');
    await limitInput().fill('7.50');
    await page.getByRole('switch', { name: /Buat draf transaksi/ }).click();
    await expect.element(saveButton()).toBeEnabled();
    await saveButton().click();
    await expect
      .element(page.getByRole('alert').filter({ hasText: 'Konfigurasi berubah di tempat lain' }))
      .toBeVisible();
    await expect.element(keyInput()).toHaveValue('sk-or-v1-new');
    await expect.element(limitInput()).toHaveValue('7.50');
    await expect.element(page.getByRole('switch', { name: /Buat draf transaksi/ })).toBeChecked();
    expect(server.saveAiSettings).toHaveBeenCalledWith({
      data: {
        expectedRevision: 'rev-1',
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-5.5',
        allowReadFinancial: true,
        allowCreateDrafts: true,
        requireConfirmation: true,
        monthlyLimitUsd: '7.50',
        pricing: null,
        apiKey: 'sk-or-v1-new',
      },
    });

    await page.getByRole('button', { name: 'Batal' }).click();
    await expect.element(keyInput()).toHaveValue('');
    await expect.element(limitInput()).toHaveValue('5.00');
    await expect.element(page.getByRole('switch', { name: /Buat draf transaksi/ })).not.toBeChecked();
    await expect.element(saveButton()).toBeDisabled();

    server.saveAiSettings.mockResolvedValueOnce({
      ok: true,
      value: baseView({ monthlyLimitUsd: '7.50', allowCreateDrafts: true }),
    });
    await limitInput().fill('7.50');
    await page.getByRole('switch', { name: /Buat draf transaksi/ }).click();
    await saveButton().click();
    await expect.element(keyInput()).toHaveValue('');
    await expect.element(limitInput()).toHaveValue('7.50');
    await expect.element(page.getByText('Tersinkron ke semua perangkat')).toBeVisible();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Konfigurasi AI disimpan' });
    });
  });

  it('surfaces a network failure without clearing the draft', async () => {
    server.saveAiSettings.mockRejectedValueOnce(new Error('offline'));
    await render();
    await limitInput().fill('6');
    await saveButton().click();
    await expect.element(page.getByText('Koneksi terputus. Coba lagi.')).toBeVisible();
    await expect.element(limitInput()).toHaveValue('6');
  });

  it('retries a stale save after re-authentication', async () => {
    server.saveAiSettings
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockResolvedValueOnce({ ok: true, value: baseView({ monthlyLimitUsd: '6' }) });
    await render();
    await limitInput().fill('6');
    await saveButton().click();
    await vi.waitFor(() => {
      expect(reauth.reauthenticate).toHaveBeenCalledTimes(1);
      expect(server.saveAiSettings).toHaveBeenCalledTimes(2);
    });
    await expect.element(limitInput()).toHaveValue('6');
  });

  it('requires 2FA and links to the Security section', async () => {
    const { router } = await render(baseView({ twoFactorEnabled: false }));
    await expect.element(page.getByText(/Aktifkan verifikasi dua langkah di Keamanan/)).toBeVisible();
    await page.getByRole('button', { name: 'Buka Keamanan' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.search).toMatchObject({ settings: 'security' });
    });
  });

  it('keeps the draft when the server refuses the save for 2FA', async () => {
    server.saveAiSettings.mockResolvedValueOnce({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    await render();
    await limitInput().fill('6');
    await saveButton().click();
    await expect.element(page.getByText(/Aktifkan verifikasi dua langkah di Keamanan/)).toBeVisible();
    await expect.element(limitInput()).toHaveValue('6');
  });

  it('deletes a key only after its own confirmation', async () => {
    server.removeAiKey.mockResolvedValueOnce({
      ok: true,
      value: baseView({
        revision: 'rev-2',
        connections: [
          connection({
            last4: null,
            status: 'not_connected',
            addedAt: null,
            testedAt: null,
            errorCode: null,
            httpStatus: null,
          }),
        ],
      }),
    });
    await render();
    await page.getByRole('button', { name: 'Hapus key' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Hapus key OpenRouter?' });
    await expect.element(confirm.getByText(/Log aktivitas tetap disimpan 30 hari/)).toBeVisible();
    await expect.element(confirm.getByText(/Permintaan AI berhenti/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Batal' }).click();
    expect(server.removeAiKey).not.toHaveBeenCalled();

    await page.getByRole('button', { name: 'Hapus key' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hapus key' }).click();
    await vi.waitFor(() => {
      expect(server.removeAiKey).toHaveBeenCalledWith({
        data: { provider: 'openrouter', expectedRevision: 'rev-1' },
      });
    });
    await expect.element(page.getByText('Belum ada key')).toBeVisible();
    expect(page.getByRole('button', { name: 'Hapus key' }).elements()).toHaveLength(0);
  });

  it('tests only saved configuration, one deliberate billed request at a time', async () => {
    const gate = Promise.withResolvers<unknown>();
    server.testAiConnection.mockReturnValueOnce(gate.promise);
    server.testAiConnection.mockResolvedValueOnce({
      ok: true,
      value: {
        connection: connection({ testedAt: LATER }),
        usage: { ...baseView().usage, requests: 313 },
      },
    });
    await render();
    await testButton().click();
    await expect.element(testButton()).toBeDisabled();
    await expect.element(page.getByRole('button', { name: /ZenMux/ })).toBeDisabled();
    await expect.element(keyInput()).toBeDisabled();
    const testCall = z.object({
      data: z.object({
        provider: z.literal('openrouter'),
        expectedRevision: z.literal('rev-1'),
        requestId: z.uuid(),
      }),
    });
    const firstCall = testCall.parse(server.testAiConnection.mock.calls[0]?.[0] as unknown);
    expect(firstCall.data.provider).toBe('openrouter');
    gate.resolve({
      ok: true,
      value: {
        connection: connection({ status: 'invalid_key', httpStatus: 401, errorCode: 'invalid_key' }),
        usage: baseView().usage,
      },
    });
    await expect.poll(() => page.getByRole('region', { name: 'Tes' }).query()?.textContent).toMatch(/HTTP 401/);
    await expect.poll(() => page.getByRole('region', { name: 'Tes' }).query()?.textContent).toMatch(/Key tidak valid/);

    await testButton().click();
    await expect
      .poll(() => page.getByRole('region', { name: 'Tes' }).query()?.textContent)
      .toMatch(/inferensi berhasil/);
    const secondCall = testCall.parse(server.testAiConnection.mock.calls[1]?.[0] as unknown);
    expect(secondCall.data.requestId).not.toBe(firstCall.data.requestId);

    await limitInput().fill('9');
    await expect.element(testButton()).toBeDisabled();
    await expect.element(page.getByText('Simpan konfigurasi dulu sebelum menguji.')).toBeVisible();
    expect(server.testAiConnection).toHaveBeenCalledTimes(2);
  });

  it('loads the public catalog, switches to manual prices, and saves them', async () => {
    const gate = Promise.withResolvers<unknown>();
    server.listAiModels.mockReturnValueOnce(gate.promise);
    server.saveAiSettings.mockResolvedValueOnce({
      ok: true,
      value: baseView({ connections: [connection({ pricing: null, pricingSource: 'manual' })] }),
    });
    await render();
    await page.getByRole('button', { name: 'Muat daftar model' }).click();
    await expect.element(page.getByRole('button', { name: 'Memuat model…' })).toBeDisabled();
    gate.resolve({ ok: true, value: CATALOG });
    expect(server.listAiModels).toHaveBeenCalledWith({ data: { provider: 'openrouter' } });

    await page.getByRole('combobox', { name: 'Model' }).selectOptions('meta/llama-free');
    await expect.element(page.getByText(/Model ini tidak mencantumkan harga/)).toBeVisible();
    await expect.element(page.getByRole('radio', { name: 'Harga manual' })).toBeChecked();
    await page.getByLabelText('Input per 1 jt token (USD)').fill('1');
    await page.getByLabelText('Output per 1 jt token (USD)').fill('2');
    await page.getByLabelText('Per permintaan (USD)').fill('0.001');
    await page.getByLabelText('Per gambar (USD)').fill('0');
    await saveButton().click();
    await vi.waitFor(() => {
      expect(server.saveAiSettings).toHaveBeenCalledWith({
        data: {
          expectedRevision: 'rev-1',
          provider: 'openrouter',
          modelId: 'meta/llama-free',
          allowReadFinancial: true,
          allowCreateDrafts: false,
          requireConfirmation: true,
          monthlyLimitUsd: '5.00',
          pricing: {
            inputUsdPerMillion: '1',
            outputUsdPerMillion: '2',
            requestUsd: '0.001',
            imageUsd: '0',
          },
        },
      });
    });
  });

  it('rejects invalid manual prices before saving and keeps the catalog error recoverable', async () => {
    server.listAiModels.mockRejectedValueOnce(new Error('offline'));
    server.listAiModels.mockResolvedValueOnce({ ok: true, value: CATALOG });
    await render();
    await page.getByRole('button', { name: 'Muat daftar model' }).click();
    await expect.element(page.getByText(/Daftar model tidak dapat dimuat/)).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi' }).click();

    await page.getByRole('radio', { name: 'Harga manual' }).click();
    await page.getByLabelText('Input per 1 jt token (USD)').fill('-1');
    await expect.element(page.getByText('Masukkan harga USD yang tidak negatif.')).toBeVisible();
    await saveButton().click();
    await expect.element(page.getByText('Masukkan harga USD yang tidak negatif.').last()).toBeVisible();
    expect(server.saveAiSettings).not.toHaveBeenCalled();
  });

  it('switches provider without falling back to another provider’s key', async () => {
    server.saveAiSettings.mockResolvedValueOnce({
      ok: true,
      value: baseView({ provider: 'zenmux', connections: [connection()] }),
    });
    await render();
    await page.getByRole('button', { name: /ZenMux/ }).click();
    await expect.element(page.getByRole('region', { name: 'Koneksi ZenMux' }).getByText('Belum ada key')).toBeVisible();
    await expect.element(keyInput()).toHaveValue('');
    await page.getByLabelText('Atau ketik ID model').fill('z-1');
    await saveButton().click();
    await vi.waitFor(() => {
      expect(server.saveAiSettings).toHaveBeenCalledWith({
        data: {
          expectedRevision: 'rev-1',
          provider: 'zenmux',
          modelId: 'z-1',
          allowReadFinancial: true,
          allowCreateDrafts: false,
          requireConfirmation: true,
          monthlyLimitUsd: '5.00',
          pricing: null,
        },
      });
    });
  });

  it('limits a custom base URL to the saved allowed endpoints', async () => {
    server.listAiModels.mockResolvedValueOnce({ ok: true, value: { ...CATALOG, provider: 'custom' } });
    const custom = connection({
      provider: 'custom',
      baseUrl: 'https://alt.example.test/v1',
      last4: 'ab12',
      modelId: 'custom-model',
    });
    await render(
      baseView({
        connections: [connection(), custom],
        allowedCustomBaseUrls: ['https://api.example.test/v1', 'https://alt.example.test/v1'],
      }),
    );
    await page.getByRole('button', { name: /Custom/ }).click();
    const load = page.getByRole('button', { name: 'Muat daftar model' });
    const origin = page.getByRole('combobox', { name: 'Base URL' });
    await expect.element(origin).toHaveValue('https://alt.example.test/v1');
    await expect.element(load).toBeEnabled();
    await userEvent.selectOptions(origin, 'https://api.example.test/v1');
    await expect.element(load).toBeDisabled();
    await expect
      .element(page.getByText('Simpan base URL dan key ini dulu sebelum memuat katalog kustom.'))
      .toBeVisible();
    await userEvent.selectOptions(origin, 'https://alt.example.test/v1');
    await expect.element(load).toBeEnabled();
    await load.click();
    await vi.waitFor(() => {
      expect(server.listAiModels).toHaveBeenCalledWith({
        data: { provider: 'custom', baseUrl: 'https://alt.example.test/v1' },
      });
    });
  });

  it('refuses an invalid key, model, or endpoint change before calling the server', async () => {
    const custom = connection({
      provider: 'custom',
      baseUrl: 'https://api.example.test/v1',
      last4: 'ab12',
      modelId: 'custom-model',
    });
    await render(
      baseView({
        connections: [connection(), custom],
        allowedCustomBaseUrls: ['https://api.example.test/v1', 'https://alt.example.test/v1'],
      }),
    );
    await page.getByRole('button', { name: /Custom/ }).click();
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Base URL' }), 'https://alt.example.test/v1');
    await saveButton().click();
    await expect.element(page.getByText(/Masukkan key baru saat mengubah base URL/)).toBeVisible();
    expect(server.saveAiSettings).not.toHaveBeenCalled();

    await keyInput().fill('abc');
    await page.getByLabelText('Atau ketik ID model').fill('bad model');
    await saveButton().click();
    await expect.element(page.getByText(/Gunakan 4–512 karakter tanpa spasi/)).toBeVisible();
    await expect.element(page.getByText(/Gunakan huruf, angka, dan/)).toBeVisible();
    expect(server.saveAiSettings).not.toHaveBeenCalled();
  });

  it('disables Custom when the operator allows no base URL', async () => {
    await render(baseView({ allowedCustomBaseUrls: [] }));
    await expect.element(page.getByRole('button', { name: /Custom/ })).toBeDisabled();
  });

  it('shows usage with subcent precision and the accounting limits', async () => {
    const view = baseView({
      usage: {
        month: '2026-10',
        requests: 312,
        spentUsd: '0.016',
        estimatedUsd: '0.00001',
        reservedUsd: '0.0004',
        limitUsd: '5',
      },
    });
    await render(view);
    const cost = costRegion();
    await expect.poll(() => cost.query()?.textContent).toMatch(/\$0,016 dari \$5,00 terpakai/);
    await expect.poll(() => cost.query()?.textContent).toMatch(/Termasuk estimasi \$0,00001/);
    await expect.poll(() => cost.query()?.textContent).toMatch(/\$0,0004 cadangan tertunda/);
    await expect.poll(() => cost.query()?.textContent).toMatch(/bukan jaminan tagihan penuh/);
    await expect.poll(() => cost.query()?.textContent).toMatch(/tidak pernah ditampilkan sebagai nol/);
    await expect.element(page.getByRole('switch', { name: /Selalu minta konfirmasi/ })).toBeChecked();
    await expect.element(page.getByRole('switch', { name: /Selalu minta konfirmasi/ })).toBeDisabled();
  });

  it('masks USD amounts in privacy mode', async () => {
    await renderApp(<AiSection settings={baseView()} viewer={VIEWER} timeZone={TZ} />, {
      preferences: { balancesHidden: true },
    });
    const cost = page.getByRole('region', { name: 'Batas biaya & pemakaian' });
    await expect.poll(() => cost.query()?.textContent).toMatch(/••••••/);
    expect(cost.element().textContent).not.toContain('$1,24');
    await expect.element(page.getByText('nominal disembunyikan').first()).toBeInTheDocument();
  });

  it('writes usage in the active locale', async () => {
    await render(baseView(), 'en');
    await expect.element(page.getByText(/Usage for October 2026/)).toBeVisible();
    await expect.element(page.getByText(/\$1.24 of \$5.00 spent/)).toBeVisible();
    await expect.element(page.getByText(/Including \$0.02 estimated/)).toBeVisible();
  });

  it('shows the 30-day metadata log with details and no fabricated zeroes', async () => {
    const secondPage = {
      ok: true,
      value: {
        total: 2,
        failed: 1,
        items: [
          logView({ id: '1' }),
          logView({
            id: '2',
            feature: 'receipt',
            status: 'timeout',
            modelId: null,
            httpStatus: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            costSource: 'unknown',
            durationMs: 10_000,
            dataSent: { images: 2, categories: 0, accounts: 0, transactions: 0 },
            toolCalls: [],
            errorCode: 'timeout',
          }),
        ],
      },
    };
    server.listAiLogs.mockResolvedValueOnce(secondPage);
    await render();
    await logButton().click();
    await vi.waitFor(() => {
      expect(server.listAiLogs).toHaveBeenCalledWith({ data: { offset: 0, limit: 20 } });
    });
    const log = page.getByRole('region', { name: 'Log aktivitas agent' });
    await expect.poll(() => log.query()?.textContent).toMatch(/Permintaan Oktober 2026/);
    await expect.poll(() => log.query()?.textContent).toMatch(/\$1,24 \/ \$5,00/);
    await expect
      .poll(() => log.query()?.textContent)
      .toMatch(/Gagal 50,00% dari permintaan yang cocok dalam 30 hari terakhir/);
    const timeoutRow = log.getByRole('listitem').nth(1);
    await expect.poll(() => timeoutRow.query()?.textContent).toMatch(/—/);
    await expect.poll(() => timeoutRow.query()?.textContent).not.toMatch(/\$0,00/);

    await log.getByRole('button', { name: 'Tampilkan detail Chat' }).click();
    await expect
      .poll(() => log.query()?.textContent)
      .toMatch(/Anthropic\/claude-sonnet-5\.5|anthropic\/claude-sonnet-5\.5/);
    await expect.poll(() => log.query()?.textContent).toMatch(/dilaporkan/);
    await expect.poll(() => log.query()?.textContent).toMatch(/0 gambar · 1 kategori · 2 rekening · 14 transaksi/);
    await expect.poll(() => log.query()?.textContent).toMatch(/buat_transaksi_draft/);
    await expect.poll(() => log.query()?.textContent).toMatch(/\$0,016/);

    await log.getByRole('button', { name: 'Tampilkan detail Baca struk' }).click();
    await expect.poll(() => log.query()?.textContent).toMatch(/2 gambar · 0 kategori · 0 rekening · 0 transaksi/);
    await expect.poll(() => log.query()?.textContent).toMatch(/tidak diketahui/);
    await expect.poll(() => log.query()?.textContent).toMatch(/timeout/);
  });

  it('filters and pages the log, and exports every matching row', async () => {
    server.listAiLogs.mockResolvedValue({
      ok: true,
      value: { total: 21, failed: 0, items: [logView({ id: '1' })] },
    });
    let downloaded = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    server.exportAiLogs.mockResolvedValueOnce({
      ok: true,
      value: { csv: 'waktu,fitur\n16.38,chat', fileName: 'aktivitas-ai.csv' },
    });
    await render();
    await logButton().click();
    const log = page.getByRole('region', { name: 'Log aktivitas agent' });
    await expect.element(log.getByRole('button', { name: 'Berikutnya' })).toBeEnabled();
    await userEvent.selectOptions(log.getByRole('combobox', { name: 'Fitur' }), 'chat');
    await vi.waitFor(() => {
      expect(server.listAiLogs).toHaveBeenCalledWith({
        data: { feature: 'chat', offset: 0, limit: 20 },
      });
    });
    await userEvent.selectOptions(log.getByRole('combobox', { name: 'Status' }), 'error');
    await vi.waitFor(() => {
      expect(server.listAiLogs).toHaveBeenCalledWith({
        data: { feature: 'chat', status: 'error', offset: 0, limit: 20 },
      });
    });
    await log.getByRole('button', { name: 'Berikutnya' }).click();
    await vi.waitFor(() => {
      expect(server.listAiLogs).toHaveBeenCalledWith({
        data: { feature: 'chat', status: 'error', offset: 20, limit: 20 },
      });
    });
    await expect.element(log.getByRole('button', { name: 'Sebelumnya' })).toBeEnabled();

    await log.getByRole('button', { name: 'Ekspor CSV' }).click();
    await vi.waitFor(() => {
      expect(server.exportAiLogs).toHaveBeenCalledWith({ data: { feature: 'chat', status: 'error' } });
    });
    expect(downloaded).toBe('aktivitas-ai.csv');
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  });

  it('can return from a last page emptied by activity retention', async () => {
    server.listAiLogs
      .mockResolvedValueOnce({ ok: true, value: { total: 21, failed: 0, items: [logView({ id: 'first' })] } })
      .mockResolvedValueOnce({ ok: true, value: { total: 0, failed: 0, items: [] } })
      .mockResolvedValueOnce({ ok: true, value: { total: 0, failed: 0, items: [] } });
    await render();
    await logButton().click();
    const log = page.getByRole('region', { name: 'Log aktivitas agent' });
    await expect.element(log.getByRole('button', { name: 'Berikutnya' })).toBeEnabled();
    await log.getByRole('button', { name: 'Berikutnya' }).click();
    await expect.element(log.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
    await expect.element(log.getByRole('button', { name: 'Sebelumnya' })).toBeEnabled();
    await log.getByRole('button', { name: 'Sebelumnya' }).click();
    await expect.element(log.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
    await expect.poll(() => log.getByRole('button', { name: 'Sebelumnya' }).elements().length).toBe(0);
  });

  it('shows the empty log', async () => {
    server.listAiLogs.mockResolvedValueOnce({ ok: true, value: { total: 0, failed: 0, items: [] } });
    await render();
    await logButton().click();
    await expect.element(page.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
  });

  it('shows a failed log and retries it', async () => {
    server.listAiLogs.mockResolvedValueOnce({ ok: false, code: 'AI_CONFIG_CHANGED' });
    await render();
    await logButton().click();
    await expect.element(page.getByText('Log tidak dapat dimuat.')).toBeVisible();
    await expect.element(page.getByText(/Konfigurasi berubah di tempat lain/)).toBeVisible();
    server.listAiLogs.mockResolvedValueOnce({ ok: true, value: { total: 0, failed: 0, items: [] } });
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await vi.waitFor(() => {
      expect(server.listAiLogs).toHaveBeenCalledTimes(2);
    });
    await expect.element(page.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
  });

  it('fits the narrow settings content and toggles a detail with the keyboard', async () => {
    await page.viewport(768, 900);
    server.listAiLogs.mockResolvedValueOnce({
      ok: true,
      value: { total: 1, failed: 0, items: [logView({ id: '1' })] },
    });
    await renderApp(
      <div className="mx-auto w-full max-w-[476px] px-7">
        <AiSection settings={baseView()} viewer={VIEWER} timeZone={TZ} />
      </div>,
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(768);
    await page.getByRole('button', { name: 'Lihat log' }).click();
    const detail = page.getByRole('button', { name: 'Tampilkan detail Chat' });
    await expect.element(detail).toBeVisible();
    detail.element().focus();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText(/buat_transaksi_draft/)).toBeVisible();
  });

  it('returns to the settings from the log without losing them', async () => {
    server.listAiLogs.mockResolvedValueOnce({
      ok: true,
      value: { total: 1, failed: 0, items: [logView({ id: '1' })] },
    });
    await render();
    await logButton().click();
    await page.getByRole('button', { name: 'Kembali ke pengaturan' }).click();
    await expect.element(page.getByRole('region', { name: 'Koneksi OpenRouter' })).toBeVisible();
  });
});

describe('AiSection boundaries', () => {
  const manualModel = () => page.getByLabelText('Atau ketik ID model');
  const loadButton = () => page.getByRole('button', { name: 'Muat daftar model' });

  it('refuses a save without a model, an endpoint, or a readable limit, and clears each error once fixed', async () => {
    server.saveAiSettings.mockResolvedValueOnce({ ok: true, value: baseView() });
    await render(baseView({ allowedCustomBaseUrls: ['https://api.example.test/v1'] }));
    await manualModel().fill('');
    await limitInput().fill('lima');
    await saveButton().click();
    await expect.element(page.getByText('Pilih atau ketik ID model.')).toBeVisible();
    await expect.element(page.getByText('Masukkan nominal USD yang tidak negatif.')).toBeVisible();
    await limitInput().fill('6');
    await expect.element(page.getByText('Masukkan nominal USD yang tidak negatif.')).not.toBeInTheDocument();
    await manualModel().fill('anthropic/claude-sonnet-5.5');
    await expect.element(page.getByText('Pilih atau ketik ID model.')).not.toBeInTheDocument();
    expect(server.saveAiSettings).not.toHaveBeenCalled();

    // Custom without a saved connection starts with no endpoint chosen.
    await page.getByRole('button', { name: /Custom/ }).click();
    const origin = page.getByRole('combobox', { name: 'Base URL' });
    await expect.element(origin).toHaveValue('');
    await keyInput().fill('sk-custom-key');
    await manualModel().fill('custom-model');
    await saveButton().click();
    await expect.element(page.getByText('Pilih base URL.')).toBeVisible();
    expect(server.saveAiSettings).not.toHaveBeenCalled();
    await userEvent.selectOptions(origin, 'https://api.example.test/v1');
    await expect.element(page.getByText('Pilih base URL.')).not.toBeInTheDocument();
    await saveButton().click();
    await vi.waitFor(() => {
      expect(server.saveAiSettings).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'custom',
          baseUrl: 'https://api.example.test/v1',
          apiKey: 'sk-custom-key',
          modelId: 'custom-model',
          monthlyLimitUsd: '6',
        }) as unknown,
      });
    });
  });

  it('keeps a saved custom provider unusable once the operator withdrew every endpoint', async () => {
    await render(
      baseView({
        provider: 'custom',
        connections: [connection({ provider: 'custom', baseUrl: 'https://gone.example.test/v1', modelId: 'm-1' })],
        allowedCustomBaseUrls: [],
      }),
    );
    const origin = page.getByRole('combobox', { name: 'Base URL' });
    await expect.element(origin).toBeDisabled();
    await expect.element(origin).toHaveTextContent('Operator belum mengizinkan base URL kustom.');
  });

  it('restores another provider’s own manual prices when switching to it', async () => {
    await render(
      baseView({
        connections: [
          connection(),
          connection({ provider: 'zenmux', baseUrl: 'https://zenmux.ai/api/v1', pricingSource: 'manual' }),
        ],
      }),
    );
    await page.getByRole('button', { name: /ZenMux/ }).click();
    await expect.element(page.getByRole('radio', { name: 'Harga manual' })).toBeChecked();
    await expect.element(page.getByText(/^Harga manual: /)).toBeVisible();
    await expect.element(page.getByLabelText('Input per 1 jt token (USD)')).toHaveValue('3');
  });

  it('turns financial reading off only through an explicit save', async () => {
    server.saveAiSettings.mockResolvedValueOnce({ ok: true, value: baseView({ allowReadFinancial: false }) });
    await render();
    await page.getByRole('switch', { name: /Baca data keuangan/ }).click();
    expect(server.saveAiSettings).not.toHaveBeenCalled();
    await saveButton().click();
    await vi.waitFor(() => {
      expect(server.saveAiSettings).toHaveBeenCalledWith({
        data: expect.objectContaining({ allowReadFinancial: false }) as unknown,
      });
    });
  });

  it('retries a stale key removal after signing in again, and keeps the key when removal fails', async () => {
    server.removeAiKey
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockResolvedValueOnce({ ok: false, code: 'AI_CONFIG_CHANGED' })
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    await render();
    const removeKey = async () => {
      await page.getByRole('button', { name: 'Hapus key' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Hapus key' }).click();
    };
    await removeKey();
    await expect
      .element(page.getByRole('alert').filter({ hasText: 'Konfigurasi berubah di tempat lain' }))
      .toBeVisible();
    expect(reauth.reauthenticate).toHaveBeenCalledOnce();
    expect(server.removeAiKey).toHaveBeenNthCalledWith(2, {
      data: { provider: 'openrouter', expectedRevision: 'rev-1' },
    });
    await removeKey();
    await expect.element(page.getByText('Koneksi terputus. Coba lagi.')).toBeVisible();
    await expect.element(page.getByText(/3f9a · terenkripsi/)).toBeVisible();
    await removeKey();
    await expect.element(page.getByText('Koneksi terputus. Coba lagi.')).toBeVisible();
    expect(server.removeAiKey).toHaveBeenCalledTimes(5);
  });

  it('retries a stale connection test with the same request after signing in again, and reports refusals', async () => {
    server.testAiConnection
      .mockResolvedValueOnce({ ok: false, code: 'SESSION_NOT_FRESH' })
      .mockResolvedValueOnce({
        ok: true,
        value: { connection: connection({ testedAt: LATER }), usage: baseView().usage },
      })
      .mockResolvedValueOnce({ ok: false, code: 'AI_PROVIDER_FAILED' })
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    await render();
    await testButton().click();
    await expect
      .poll(() => page.getByRole('region', { name: 'Tes' }).query()?.textContent)
      .toMatch(/inferensi berhasil/);
    expect(reauth.reauthenticate).toHaveBeenCalledOnce();
    expect(server.testAiConnection.mock.calls[1]?.[0]).toEqual(server.testAiConnection.mock.calls[0]?.[0]);
    await testButton().click();
    await expect.element(page.getByText(/Tes gagal\. Penyedia tidak menjawab dengan sukses/)).toBeVisible();
    await testButton().click();
    await expect.element(page.getByText('Tes gagal. Koneksi terputus. Coba lagi.')).toBeVisible();
    await testButton().click();
    await expect.element(page.getByText('Tes gagal. Koneksi terputus. Coba lagi.')).toBeVisible();
    expect(server.testAiConnection).toHaveBeenCalledTimes(6);
  });

  it('drops a catalog answer for a provider the user already left, also around signing in again', async () => {
    const stale = Promise.withResolvers<unknown>();
    server.listAiModels.mockReturnValueOnce(stale.promise);
    await render();
    // 1. The answer arrives after switching provider.
    await loadButton().click();
    await page.getByRole('button', { name: /ZenMux/ }).click();
    stale.resolve({ ok: true, value: CATALOG });
    await expect.element(loadButton()).toBeEnabled();
    expect(page.getByText(/model · bukan tes inferensi/).elements()).toHaveLength(0);

    // 2. The user switches while signing in again.
    const signedIn = Promise.withResolvers<boolean>();
    server.listAiModels.mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' });
    reauth.reauthenticate.mockReturnValueOnce(signedIn.promise);
    await loadButton().click();
    await vi.waitFor(() => {
      expect(reauth.reauthenticate).toHaveBeenCalledOnce();
    });
    await page.getByRole('button', { name: /OpenRouter/ }).click();
    signedIn.resolve(true);
    await expect.element(loadButton()).toBeEnabled();
    expect(server.listAiModels).toHaveBeenCalledTimes(2);

    // 3. The user switches while the retried request runs.
    const retried = Promise.withResolvers<unknown>();
    server.listAiModels
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockReturnValueOnce(retried.promise);
    await loadButton().click();
    await vi.waitFor(() => {
      expect(server.listAiModels).toHaveBeenCalledTimes(4);
    });
    await page.getByRole('button', { name: /ZenMux/ }).click();
    retried.resolve({ ok: true, value: CATALOG });
    await expect.element(loadButton()).toBeEnabled();
    expect(page.getByText(/model · bukan tes inferensi/).elements()).toHaveLength(0);
  });

  it('explains a refused or empty catalog and describes a priced model it lists', async () => {
    server.listAiModels
      .mockResolvedValueOnce({ ok: false, code: 'TWO_FACTOR_REQUIRED' })
      .mockResolvedValueOnce({ ok: true, value: { ...CATALOG, models: [] } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ...CATALOG,
          models: [
            { id: 'priced/no-context', name: 'Priced', contextLength: null, maxOutputTokens: null, pricing: PRICING },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'));
    await render();
    await loadButton().click();
    await expect.element(page.getByText(/Daftar model tidak dapat dimuat\./)).toBeVisible();
    await expect.element(page.getByText(/Aktifkan verifikasi dua langkah di Keamanan/)).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(page.getByText('Katalog tidak berisi model. Ketik ID model secara manual.')).toBeVisible();
    await expect.element(page.getByText(/Aktifkan verifikasi dua langkah di Keamanan/)).not.toBeInTheDocument();
    await loadButton().click();
    await page.getByRole('combobox', { name: 'Model' }).selectOptions('priced/no-context');
    await expect.element(page.getByRole('radio', { name: 'Harga katalog' })).toBeChecked();
    await expect.element(page.getByText(/^Harga katalog: /).first()).toBeVisible();
    expect(page.getByText(/token konteks/).elements()).toHaveLength(0);
    await loadButton().click();
    await expect.element(page.getByText('Daftar model tidak dapat dimuat. Koneksi terputus. Coba lagi.')).toBeVisible();
    expect(server.listAiModels).toHaveBeenCalledTimes(5);
  });

  it('keeps the draft when signing in again is cancelled or the retried save cannot reach the server', async () => {
    server.saveAiSettings
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockResolvedValueOnce({ ok: false, code: 'REAUTHENTICATION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'));
    reauth.reauthenticate.mockResolvedValueOnce(false);
    await render();
    await limitInput().fill('6');
    await saveButton().click();
    await vi.waitFor(() => {
      expect(reauth.reauthenticate).toHaveBeenCalledOnce();
    });
    expect(server.saveAiSettings).toHaveBeenCalledOnce();
    await expect.element(saveButton()).toBeEnabled();
    await saveButton().click();
    await expect.element(page.getByText('Koneksi terputus. Coba lagi.')).toBeVisible();
    expect(server.saveAiSettings).toHaveBeenCalledTimes(3);
    await expect.element(limitInput()).toHaveValue('6');
  });
});

describe('AiLogPanel boundaries', () => {
  it('shows today’s entries by clock time and says when nothing financial was sent', async () => {
    server.listAiLogs.mockResolvedValueOnce({
      ok: true,
      value: {
        total: 1,
        failed: 0,
        items: [
          logView({
            id: 'now',
            createdAt: new Date(),
            dataSent: { images: 0, categories: 0, accounts: 0, transactions: 0 },
          }),
        ],
      },
    });
    await render();
    await logButton().click();
    const row = page.getByRole('listitem').first();
    await expect.element(row).toBeVisible();
    expect(row.element().querySelector('span')?.textContent).toMatch(/^\d{2}[.:]\d{2}$/);
    const detail = row.getByRole('button', { name: 'Tampilkan detail Chat' });
    await detail.click();
    await expect.element(row).toMatchTextContent('Tidak ada data keuangan dikirim');
    await row.getByRole('button', { name: 'Sembunyikan detail Chat' }).click();
    expect(row.element().textContent).not.toContain('Tidak ada data keuangan dikirim');
  });

  it('ignores answers for a filter the user already changed, including failed ones', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    server.listAiLogs
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce({ ok: true, value: { total: 0, failed: 0, items: [] } });
    await render();
    await logButton().click();
    const log = page.getByRole('region', { name: 'Log aktivitas agent' });
    await userEvent.selectOptions(log.getByRole('combobox', { name: 'Fitur' }), 'chat');
    await userEvent.selectOptions(log.getByRole('combobox', { name: 'Status' }), 'error');
    await expect.element(log.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
    first.resolve({ ok: true, value: { total: 1, failed: 0, items: [logView({ id: 'stale' })] } });
    second.reject(new Error('offline'));
    await expect.element(log.getByText('Belum ada aktivitas dalam 30 hari.')).toBeVisible();
    expect(log.getByText('Log tidak dapat dimuat.').elements()).toHaveLength(0);
  });

  it('reports an unreachable log and a CSV that could not be made, without downloading', async () => {
    server.listAiLogs.mockRejectedValueOnce(new Error('offline'));
    server.exportAiLogs.mockRejectedValueOnce(new Error('offline'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await renderApp(<AiSection settings={baseView()} viewer={VIEWER} timeZone={TZ} />, {
      preferences: { balancesHidden: true },
    });
    await logButton().click();
    const log = page.getByRole('region', { name: 'Log aktivitas agent' });
    await expect.element(log.getByText('Log tidak dapat dimuat.')).toBeVisible();
    expect(log.element().textContent).not.toContain('$1,24');
    await log.getByRole('button', { name: 'Ekspor CSV' }).click();
    await expect.element(log.getByText('CSV tidak dapat dibuat.')).toBeVisible();
    expect(server.exportAiLogs).toHaveBeenCalledWith({ data: {} });
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
