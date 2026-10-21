// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A category's glyph in its tinted color chip (design category rows, pickers, and the "Ikon" grid). Icons are
 * stored as lucide names (`shopping-bag`); {@link CATEGORY_ICONS} is the set the icon picker offers and every
 * built-in uses. A name this release does not know renders a neutral glyph.
 */
import { m } from '@wf/i18n/messages';
import {
  ArrowLeftRight,
  Baby,
  BadgePercent,
  Bike,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Building,
  Bus,
  CalendarClock,
  Camera,
  Car,
  Clapperboard,
  Cloud,
  Coffee,
  Dumbbell,
  Film,
  Fuel,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  Laptop,
  LayoutGrid,
  Music,
  Palette,
  PartyPopper,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Plane,
  Play,
  Presentation,
  Receipt,
  ReceiptText,
  Repeat,
  RotateCcw,
  Scissors,
  Shapes,
  Server,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Stamp,
  Store,
  Tag,
  TrendingUp,
  Tv,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { colorProps } from '../lib/colors.ts';

/** Icon picker order: everyday spending first, then income and financial glyphs. */
export interface CategoryIconEntry {
  readonly glyph: LucideIcon;
  /** Accessible name in the icon picker. */
  readonly label: () => string;
}

export const CATEGORY_ICONS: Readonly<Record<string, CategoryIconEntry>> = {
  'graduation-cap': { glyph: GraduationCap, label: m.icon_graduation_cap },
  'book-open': { glyph: BookOpen, label: m.icon_book_open },
  baby: { glyph: Baby, label: m.icon_baby },
  'paw-print': { glyph: PawPrint, label: m.icon_paw_print },
  plane: { glyph: Plane, label: m.icon_plane },
  car: { glyph: Car, label: m.icon_car },
  'heart-pulse': { glyph: HeartPulse, label: m.icon_heart_pulse },
  dumbbell: { glyph: Dumbbell, label: m.icon_dumbbell },
  gift: { glyph: Gift, label: m.icon_gift },
  'hand-heart': { glyph: HandHeart, label: m.icon_hand_heart },
  shirt: { glyph: Shirt, label: m.icon_shirt },
  wrench: { glyph: Wrench, label: m.icon_wrench },
  utensils: { glyph: Utensils, label: m.icon_utensils },
  bus: { glyph: Bus, label: m.icon_bus },
  zap: { glyph: Zap, label: m.icon_zap },
  smartphone: { glyph: Smartphone, label: m.icon_smartphone },
  coffee: { glyph: Coffee, label: m.icon_coffee },
  'shopping-cart': { glyph: ShoppingCart, label: m.icon_shopping_cart },
  house: { glyph: House, label: m.icon_house },
  film: { glyph: Film, label: m.icon_film },
  music: { glyph: Music, label: m.icon_music },
  pill: { glyph: Pill, label: m.icon_pill },
  scissors: { glyph: Scissors, label: m.icon_scissors },
  'layout-grid': { glyph: LayoutGrid, label: m.icon_layout_grid },
  'shopping-bag': { glyph: ShoppingBag, label: m.icon_shopping_bag },
  clapperboard: { glyph: Clapperboard, label: m.icon_clapperboard },
  tv: { glyph: Tv, label: m.icon_tv },
  play: { glyph: Play, label: m.icon_play },
  bot: { glyph: Bot, label: m.icon_bot },
  cloud: { glyph: Cloud, label: m.icon_cloud },
  server: { glyph: Server, label: m.icon_server },
  brain: { glyph: Brain, label: m.icon_brain },
  bike: { glyph: Bike, label: m.icon_bike },
  repeat: { glyph: Repeat, label: m.icon_repeat },
  palette: { glyph: Palette, label: m.icon_palette },
  sparkles: { glyph: Sparkles, label: m.icon_sparkles },
  receipt: { glyph: Receipt, label: m.icon_receipt },
  fuel: { glyph: Fuel, label: m.icon_fuel },
  wifi: { glyph: Wifi, label: m.icon_wifi },
  camera: { glyph: Camera, label: m.icon_camera },
  'party-popper': { glyph: PartyPopper, label: m.icon_party_popper },
  briefcase: { glyph: Briefcase, label: m.icon_briefcase },
  laptop: { glyph: Laptop, label: m.icon_laptop },
  presentation: { glyph: Presentation, label: m.icon_presentation },
  store: { glyph: Store, label: m.icon_store },
  'hand-coins': { glyph: HandCoins, label: m.icon_hand_coins },
  'piggy-bank': { glyph: PiggyBank, label: m.icon_piggy_bank },
  wallet: { glyph: Wallet, label: m.icon_wallet },
  'trending-up': { glyph: TrendingUp, label: m.icon_trending_up },
  building: { glyph: Building, label: m.icon_building },
  'rotate-ccw': { glyph: RotateCcw, label: m.icon_rotate_ccw },
  tag: { glyph: Tag, label: m.icon_tag },
  landmark: { glyph: Landmark, label: m.icon_landmark },
  'badge-percent': { glyph: BadgePercent, label: m.icon_badge_percent },
  'calendar-clock': { glyph: CalendarClock, label: m.icon_calendar_clock },
  'receipt-text': { glyph: ReceiptText, label: m.icon_receipt_text },
  stamp: { glyph: Stamp, label: m.icon_stamp },
  percent: { glyph: Percent, label: m.icon_percent },
  'arrow-left-right': { glyph: ArrowLeftRight, label: m.icon_arrow_left_right },
};

const SIZES = {
  sm: { chip: 'size-[22px] rounded-[6px]', glyph: 'size-3' },
  md: { chip: 'size-7 rounded-[7px]', glyph: 'size-[14px]' },
  lg: { chip: 'size-9 rounded-[9px]', glyph: 'size-[18px]' },
} as const;

export interface CategoryIconProps {
  /** Lucide name, e.g. `shopping-bag`. */
  readonly icon: string;
  /** Color token or `#rrggbb` (see `lib/colors.ts`). */
  readonly color: string;
  readonly size?: keyof typeof SIZES;
}

/** Decorative: the category's name is always shown next to it. */
export function CategoryIcon({ icon, color, size = 'md' }: CategoryIconProps) {
  const Glyph = CATEGORY_ICONS[icon]?.glyph ?? Shapes;
  return (
    <span
      {...colorProps(color)}
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_16%,transparent)] text-[var(--wf-color,var(--subtle))] ${SIZES[size].chip}`}
    >
      <Glyph className={SIZES[size].glyph} />
    </span>
  );
}
