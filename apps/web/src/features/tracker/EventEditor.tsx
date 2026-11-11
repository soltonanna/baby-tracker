import type { Baby, FeedingKind } from '@baby-tracker/shared';
import type { EventFormState } from './eventForm.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { NoteForm } from './NoteForm.js';
import { SleepForm } from './SleepForm.js';

export interface EventEditorProps {
  familyId: string;
  /** The baby the form starts aimed at — for an edit, the event's own baby. */
  babyId: string;
  babies: Baby[];
  form: EventFormState;
  /** For a new feeding only: the kind it starts on. */
  defaultFeedingKind?: FeedingKind | undefined;
  /** Called after a save (once the lists are refreshed) and on cancel. */
  onClose: () => void;
}

/**
 * The entry form for a feeding, a sleep, a nappy or a note — new or an edit.
 *
 * The one place that maps a kind of entry to its form, shared by Today, where
 * entries are written, and Timeline, where past ones are corrected. Each form is
 * keyed by the event it edits, so opening it on a different entry — or on a new
 * one — remounts it and its fields start from that entry's values rather than
 * from whatever the previous one left behind.
 */
export function EventEditor({
  familyId,
  babyId,
  babies,
  form,
  defaultFeedingKind,
  onClose,
}: EventEditorProps) {
  const key = form.event?.id ?? 'new';
  const common = {
    familyId,
    babyId,
    babies,
    event: form.event,
    onSaved: onClose,
    onCancel: onClose,
  };

  switch (form.kind) {
    case 'feeding':
      return <FeedingForm {...common} key={key} defaultKind={defaultFeedingKind} />;
    case 'sleep':
      return <SleepForm {...common} key={key} />;
    case 'diaper':
      return <DiaperForm {...common} key={key} />;
    case 'note':
      return <NoteForm {...common} key={key} />;
  }
}
