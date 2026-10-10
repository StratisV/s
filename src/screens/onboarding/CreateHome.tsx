import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { DEFAULT_ADDRESS } from '../../lib/constants';
import { deviceTimeZone } from '../../lib/logic/dates';
import { seedItemsFor } from '../../lib/logic/items';
import { errorMessage, useHome } from '../../state/HomeProvider';
import { ActionSheet } from '../../ui/ActionSheet';
import { ChevronLeftIcon } from '../../ui/icons';
import { Toggle } from '../../ui/Toggle';
import { AreasEditor } from './AreasEditor';
import styles from './CreateHome.module.css';
import shared from './Onboarding.module.css';
import type { ProfileDraft } from './ProfileStep';
import { cleanAreaNames, MAX_ADDRESS, MAX_HOUSEHOLD_NAME, type HomeDraft } from './setup';
import { PrimaryButton, StepPage, type Enter } from './StepPage';

interface CreateHomeProps {
  enter: Enter;
  profile: ProfileDraft;
  value: HomeDraft;
  onChange(next: HomeDraft): void;
  onBack(): void;
}

/** Under Create Home, while this browser has no home of its own to bring over. */
export const OTHER_PHONE_HINT = 'Used home.os on your phone before? Sign in on that phone first to bring your home over.';

/**
 * Step 3 without an invite: name, address, areas, and whether to start with the current list.
 * One home per deployment, and a home kept on another phone can only come over while no home
 * exists: so on the real backend, unless this browser's own home was just turned down (Start
 * Fresh), it says so under the button and asks before creating.
 */
export function CreateHome({ enter, profile, value, onChange, onBack }: CreateHomeProps) {
  const { backend, createHousehold, showToast, canReopenDemoImport } = useHome();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const askFirst = backend.kind === 'supabase' && !canReopenDemoImport;
  const nameId = useId();
  const addressId = useId();
  const areasHeadingId = useId();

  const areas = cleanAreaNames(value.areas);
  const seedCount = seedItemsFor(areas).length;
  const ready = areas.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    if (askFirst) setConfirm(true);
    else void create();
  };

  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await createHousehold({
        name: value.name.trim() || 'Our home',
        address: value.address.trim(),
        timezone: deviceTimeZone(),
        memberName: profile.name.trim(),
        memberEmoji: profile.emoji,
        areas,
        items: value.seed ? seedItemsFor(areas) : [],
      });
      // Onboarding moves on to the notifications step by itself.
    } catch (err) {
      setBusy(false);
      showToast(errorMessage(err));
    }
  };

  // Enter in Name goes to Address; in Address it just closes the keyboard.
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>, next?: string) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (next) document.getElementById(next)?.focus();
    else e.currentTarget.blur();
  };

  let seedCaption: string;
  if (seedCount === 0) seedCaption = 'None of these areas are on the current list, so you’ll start with an empty one.';
  else if (!value.seed) seedCaption = 'Start with an empty list and add things as they come up.';
  else seedCaption = `Adds the ${seedCount} ${seedCount === 1 ? 'item' : 'items'} from our current notes list to these areas, with their notes and dates.`;

  return (
    <StepPage
      label="Your home"
      enter={enter}
      nav={
        <button type="button" className={shared.navButton} onClick={onBack} disabled={busy}>
          <ChevronLeftIcon size={20} />
          Back
        </button>
      }
    >
      <form className={shared.form} onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <fieldset className={shared.fieldset} disabled={busy}>
          <div className={shared.titleBlock}>
            <h1 className={shared.title}>Your home</h1>
            <p className={shared.subtitle}>Everyone at home can change this later.</p>
          </div>

          <div className={`${shared.card} ${styles.first}`}>
            <div className={shared.row}>
              <label className={shared.rowLabel} htmlFor={nameId}>
                Name
              </label>
              <input
                id={nameId}
                className={shared.input}
                value={value.name}
                onChange={(e) => onChange({ ...value, name: e.target.value })}
                onKeyDown={(e) => onFieldKey(e, addressId)}
                placeholder="Our home"
                maxLength={MAX_HOUSEHOLD_NAME}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
              />
            </div>
            <div className={shared.row}>
              <label className={shared.rowLabel} htmlFor={addressId}>
                Address
              </label>
              <input
                id={addressId}
                className={shared.input}
                value={value.address}
                onChange={(e) => onChange({ ...value, address: e.target.value })}
                onKeyDown={(e) => onFieldKey(e)}
                placeholder={DEFAULT_ADDRESS}
                maxLength={MAX_ADDRESS}
                autoComplete="street-address"
                autoCapitalize="words"
                enterKeyHint="done"
              />
            </div>
          </div>

          <h2 id={areasHeadingId} className={shared.sectionHeader}>
            Areas
          </h2>
          <AreasEditor
            areas={value.areas}
            onChange={(next) => onChange({ ...value, areas: next })}
            labelledBy={areasHeadingId}
            disabled={busy}
          />
          <p className={shared.caption} role={ready ? undefined : 'alert'}>
            {ready ? 'The rooms and spaces you look after. Items live in an area.' : 'Add at least one area.'}
          </p>

          <div className={`${shared.card} ${styles.seedCard}`}>
            <div className={shared.row}>
              <span className={shared.rowLabel} data-wide="">
                Start with our current list
              </span>
              <Toggle
                checked={value.seed && seedCount > 0}
                onChange={(seed) => onChange({ ...value, seed })}
                label="Start with our current list"
                disabled={busy || seedCount === 0}
              />
            </div>
          </div>
          <p className={shared.caption}>{seedCaption}</p>
        </fieldset>

        <div className={shared.spacer} />
        <div className={shared.footer}>
          <PrimaryButton type="submit" disabled={!ready} busy={busy} busyLabel="Creating Home">
            Create Home
          </PrimaryButton>
          {askFirst ? <p className={styles.hint}>{OTHER_PHONE_HINT}</p> : null}
        </div>
      </form>
      <ActionSheet
        open={confirm}
        title="Create a new home?"
        message="If your home is already on another phone, sign in on that phone first to bring it over. Only one home can be set up here."
        actions={[
          {
            label: 'Create Home',
            onSelect: () => {
              setConfirm(false);
              void create();
            },
          },
        ]}
        onCancel={() => setConfirm(false)}
      />
    </StepPage>
  );
}
