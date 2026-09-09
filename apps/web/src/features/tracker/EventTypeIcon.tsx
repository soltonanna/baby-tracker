import type { ComponentType } from 'react';
import type { BabyEventType } from '@baby-tracker/shared';
import {
  BottleIcon,
  DiaperIcon,
  MoonIcon,
  NoteIcon,
  type IconProps,
} from '../../components/ui/icons.js';

/**
 * The glyph for a kind of event.
 *
 * One map, so a row — and later a timeline — cannot disagree about what a sleep
 * looks like, and so adding a member to `BABY_EVENT_TYPES` fails to compile
 * until it has an icon. Purely decorative: every icon is `aria-hidden` and
 * always sits beside the translated type name, which is what is read out.
 */
const ICONS: Record<BabyEventType, ComponentType<IconProps>> = {
  FEEDING: BottleIcon,
  SLEEP: MoonIcon,
  DIAPER: DiaperIcon,
  NOTE: NoteIcon,
};

export interface EventTypeIconProps extends IconProps {
  type: BabyEventType;
}

export function EventTypeIcon({ type, ...props }: EventTypeIconProps) {
  const Glyph = ICONS[type];
  return <Glyph {...props} />;
}
