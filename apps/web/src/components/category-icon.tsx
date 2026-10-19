// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A category's glyph in its tinted color chip (design category rows, pickers, and the "Ikon" grid). Icons are
 * stored as lucide names (`shopping-bag`); {@link CATEGORY_ICONS} is the set the icon picker offers and every
 * built-in uses. A name this release does not know renders a neutral glyph.
 */
import {
  ArrowLeftRight,
  Baby,
  BadgePercent,
  BookOpen,
  Briefcase,
  Building,
  Bus,
  CalendarClock,
  Camera,
  Car,
  Clapperboard,
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
  Presentation,
  Receipt,
  ReceiptText,
  Repeat,
  RotateCcw,
  Scissors,
  Shapes,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Stamp,
  Store,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { colorProps } from '../lib/colors.ts';

/** Icon picker order: everyday spending first, then income and financial glyphs. */
export const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  baby: Baby,
  'paw-print': PawPrint,
  plane: Plane,
  car: Car,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  gift: Gift,
  'hand-heart': HandHeart,
  shirt: Shirt,
  wrench: Wrench,
  utensils: Utensils,
  bus: Bus,
  zap: Zap,
  smartphone: Smartphone,
  coffee: Coffee,
  'shopping-cart': ShoppingCart,
  house: House,
  film: Film,
  music: Music,
  pill: Pill,
  scissors: Scissors,
  'layout-grid': LayoutGrid,
  'shopping-bag': ShoppingBag,
  clapperboard: Clapperboard,
  repeat: Repeat,
  palette: Palette,
  sparkles: Sparkles,
  receipt: Receipt,
  fuel: Fuel,
  wifi: Wifi,
  camera: Camera,
  'party-popper': PartyPopper,
  briefcase: Briefcase,
  laptop: Laptop,
  presentation: Presentation,
  store: Store,
  'hand-coins': HandCoins,
  'piggy-bank': PiggyBank,
  wallet: Wallet,
  'trending-up': TrendingUp,
  building: Building,
  'rotate-ccw': RotateCcw,
  tag: Tag,
  landmark: Landmark,
  'badge-percent': BadgePercent,
  'calendar-clock': CalendarClock,
  'receipt-text': ReceiptText,
  stamp: Stamp,
  percent: Percent,
  'arrow-left-right': ArrowLeftRight,
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
  const Glyph = CATEGORY_ICONS[icon] ?? Shapes;
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
