# Parent Powerup

A simple, phone-first app for parents. Four tabs:

- **Meditate** (the home tab, and the core of the app): a short guided meditation every day,
  for a parent and their kids **together**, or for the parent **alone**. Today's pick fits
  the kids' ages and leans on their interests (the space-mad one gets the rocket), and stays
  the same all day. A breathing circle to follow, the words on screen and, if you like, read
  aloud. A gentle streak, never a guilt trip.
- **Powerups**: a library of techniques and tips for the common challenges of growing up,
  from night waking to exam stress. Filter by issue (sleep, big feelings, screens…). A
  timeline from birth to 18 shows when each challenge is most common; pick an age to see what
  is common then and the Powerups for it. Your kids sit on the timeline as points: tap one and
  the library shows what fits them now. Every Powerup names the expert approach it comes from
  (emotion coaching, Parent-Child Interaction Therapy, Triple P, CBT…) and lists its sources.
- **Your family**: add your kids (name, birth month, an avatar, temperament, interests, what
  you would like help with, notes). This is what personalises everything else. It is stored
  on the phone only.
- **This Week**: new research in parenting and child psychology, picked and explained in plain
  words, every week. Each item says what it means for you and links to the original study.

## Running it

```sh
cd parent-powerup
npm install
npm run dev        # http://localhost:5180
npm test           # unit and component tests (Vitest)
npm run test:e2e   # the app in an iPhone-sized browser (Playwright)
npm run build      # production build in dist/
```

It is a static site (Vite, React, TypeScript): `dist/` can be served from anywhere. On
Vercel, make a project with **Root Directory** `parent-powerup`; the framework preset (Vite)
does the rest.

### Previews

`npm run build:single && node scripts/inline-build.mjs` builds the whole app into one
self-contained page, `dist-single/parent-powerup.html`, with its fonts and icon inside, for
sharing a preview without a server.

## How it is put together

```
src/
  types.ts            every data shape
  data/               the content: issues, stages, the library (by age band),
                      meditations, the weekly digests, and the rules they follow
  lib/                ages, the timeline scale, dates, the on-device store, the router
  ui/                 the shared kit: Screen, Sheet, Chip, Button, Card, KidAvatar, Icon, TabBar
  features/
    meditate/         the home tab, today's pick and the meditation room
    library/          the Powerups tab and its timeline
    family/           Your family
    weekly/           This Week
  styles/             design tokens (light and dark) and global styles
```

- **No account, no server.** The family is saved in the browser's local storage on the phone
  (`src/lib/store.ts`); if storage is not available (a private window) the app still works
  for the visit. "Delete all my data" in Your family clears it.
- **Where the app is lives in the address** (`#/powerups?kid=…&challenge=…`), so Back works
  and one tab can send you to something in another.
- **The timeline** gives every stage the same width (`src/lib/timeline.ts`), so the first
  years, where a lot happens fast, are not squeezed beside the teens.

## The content

### Powerups

The library is in `src/data/library/`, one file per age band. Each **challenge** has the ages
it is common at and its peak (which place it on the timeline), what is normal, and when to
get support. Each **Powerup** has steps, words to try, why it works, the approach it comes
from and its **sources**: real studies, reviews, guidelines and programmes, with PubMed links
where there is one. `src/data/content.test.ts` checks the shape of all of it (ids, ages,
links, that every Powerup has sources).

A Powerup can carry a `review` (`{ by, credentials, date }`) once a named clinician has
reviewed it; the app then shows "Reviewed by …" on it. Until then it shows the approach and
sources only, and never claims a review that has not happened.

### The weekly digest

One file per ISO week in `src/data/digests/` (`2026-W46.ts`), listed in
`src/data/digests/index.ts`. Every item is a real publication with its PubMed link. To
curate a week:

1. Search PubMed for the past two or three weeks' research in parenting and child and
   adolescent psychology. Prefer trials, reviews and large cohorts in well-regarded journals,
   with a spread of ages and topics.
2. Pick five or six. For each, from the abstract: a plain headline, what they did and found,
   and what it means for a parent (never stronger than the evidence: "linked to" for
   observational work).
3. Add the file, list it in `index.ts`, and run `npm test`.

The app shows the newest issue dated on or before today, and the earlier ones under it.

## Before launch

- **Clinical review.** The Powerups and meditations are written from published, evidence-based
  approaches and every source is real, but no clinician has reviewed this text yet. Have a
  child psychologist review it, then record it with `review` on each Powerup.
- **The weekly digest** needs someone (or a scheduled task) to curate it each week.
