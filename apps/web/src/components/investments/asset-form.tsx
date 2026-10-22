// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tambah aset" / "Ubah detail aset" (FR-I1, design 09 `aW8Nv`): ticker, name, platform (new assets only; its currency
 * is the quote currency), asset class, price market, "Daftar saya" category, price source, and a manual price. The
 * class decides the asset's place in the allocation targets and the rebalancing.
 */
import type { AssetView, CategoryView, PlatformView } from '@wf/db/investments';
import { ASSET_CLASSES, PRICE_MODES, type AssetClass, type PriceMode } from '@wf/domain/investments';
import { MARKETS, type Market } from '@wf/domain/market';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Select } from '@wf/ui/select';
import { useState, type SyntheticEvent } from 'react';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { classLabel, decimalInput, decimalText, marketLabel, priceModeLabel } from './investments-model.ts';

/** The category select's value for "no category" (Radix items cannot use an empty value). */
const SINGLE = 'single';
/** The fields "Simpan" sends (`accountId` only for a new asset). */
export interface AssetDraft {
  readonly accountId: string | null;
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly market: Market;
  readonly categoryId: string | null;
  readonly priceMode: PriceMode;
  readonly manualPrice: string | null;
}

export interface AssetFormProps {
  /** `null`: closed; `{ asset: null }` a new asset. */
  readonly open: { readonly asset: AssetView | null } | null;
  readonly platforms: readonly PlatformView[];
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (draft: AssetDraft) => Promise<string | null>;
}

export function AssetForm({ open, onOpenChange, ...props }: AssetFormProps) {
  return (
    <Modal
      open={open !== null}
      onOpenChange={onOpenChange}
      title={open?.asset == null ? m.invest_asset_new_title() : m.invest_asset_edit_title()}
      description={m.invest_asset_description()}
      size="xl"
    >
      {open === null ? null : (
        <AssetFields
          asset={open.asset}
          {...props}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function AssetFields({
  asset,
  platforms,
  categories,
  locale,
  onSubmit,
  onCancel,
}: Omit<AssetFormProps, 'open' | 'onOpenChange'> & {
  readonly asset: AssetView | null;
  readonly onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(asset?.accountId ?? platforms[0]?.accountId ?? null);
  const [symbol, setSymbol] = useState(asset?.symbol ?? '');
  const [name, setName] = useState(asset?.name ?? '');
  const [assetClass, setAssetClass] = useState<AssetClass>(asset?.assetClass ?? 'us_stocks');
  const [market, setMarket] = useState<Market>(asset?.market ?? 'us_equity');
  const [categoryId, setCategoryId] = useState<string>(asset?.categoryId ?? SINGLE);
  const [priceMode, setPriceMode] = useState<PriceMode>(asset?.priceMode ?? 'manual');
  const [priceText, setPriceText] = useState(asset?.manualPrice == null ? '' : decimalText(asset.manualPrice, locale));
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const price = priceText.trim() === '' ? null : decimalInput(priceText, locale);
  const errors = {
    platform: asset === null && accountId === null ? m.invest_asset_error_platform() : null,
    symbol: symbol.trim() === '' || symbol.trim().length > 20 ? m.invest_asset_error_symbol() : null,
    name: name.trim() === '' || name.trim().length > 80 ? m.invest_asset_error_name() : null,
    price:
      priceText.trim() !== '' && price === null
        ? m.invest_trade_error_price()
        : priceMode === 'manual' && price === null
          ? m.invest_asset_error_manual()
          : null,
  };
  const platform = platforms.find((candidate) => candidate.accountId === accountId);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((error) => error !== null)) return;
    setPending(true);
    const failed = await onSubmit({
      accountId: asset === null ? accountId : null,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      market,
      categoryId: categoryId === SINGLE ? null : categoryId,
      priceMode,
      manualPrice: price,
    });
    setPending(false);
    setFailure(failed);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.invest_asset_symbol()} error={showErrors ? errors.symbol : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              autoFocus
              value={symbol}
              maxLength={20}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setSymbol(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <Field label={m.invest_asset_name()} error={showErrors ? errors.name : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              value={name}
              maxLength={80}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <Field
          label={m.invest_asset_platform()}
          hint={platform === undefined ? undefined : m.invest_asset_currency({ currency: platform.currency })}
          error={showErrors ? errors.platform : null}
        >
          {({ id }) =>
            asset === null ? (
              <Select
                id={id}
                value={accountId}
                onValueChange={setAccountId}
                placeholder={m.invest_trade_account_pick()}
                options={platforms.map((candidate) => ({ value: candidate.accountId, label: candidate.name }))}
              />
            ) : (
              <TextInput id={id} value={asset.platformName} disabled readOnly />
            )
          }
        </Field>
        <Field label={m.invest_asset_class()} hint={m.invest_asset_class_hint()}>
          {({ id }) => (
            <Select
              id={id}
              placeholder={m.invest_pick()}
              value={assetClass}
              onValueChange={setAssetClass}
              options={ASSET_CLASSES.map((value) => ({ value, label: classLabel(value) }))}
            />
          )}
        </Field>
        <Field label={m.invest_asset_market()}>
          {({ id }) => (
            <Select
              id={id}
              placeholder={m.invest_pick()}
              value={market}
              onValueChange={setMarket}
              options={MARKETS.filter((value) => value !== 'fx').map((value) => ({ value, label: marketLabel(value) }))}
            />
          )}
        </Field>
        <Field label={m.invest_asset_category()}>
          {({ id }) => (
            <Select
              id={id}
              placeholder={m.invest_pick()}
              value={categoryId}
              onValueChange={setCategoryId}
              options={[
                { value: SINGLE, label: m.invest_move_single() },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
          )}
        </Field>
        <Field label={m.invest_asset_price_mode()}>
          {({ id }) => (
            <Select
              id={id}
              placeholder={m.invest_pick()}
              value={priceMode}
              onValueChange={setPriceMode}
              options={PRICE_MODES.map((value) => ({ value, label: priceModeLabel(value) }))}
            />
          )}
        </Field>
        <Field
          label={m.invest_asset_manual_price({ currency: platform?.currency ?? asset?.quoteCurrency ?? '' })}
          aside={priceMode === 'manual' ? undefined : m.invest_optional()}
          error={showErrors ? errors.price : null}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={priceText}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setPriceText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
      <p className="text-[12px] text-subtle">{m.invest_asset_note()}</p>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {m.invest_asset_save()}
        </Button>
      </div>
    </form>
  );
}
