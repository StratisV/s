# Handoff: HomeOS (household maintenance tracker)

## Overview
HomeOS is a very simple iPhone-first app for one household (21 Alderbrook Road). It lists the **areas** of the home (Kitchen, Garden, Jacuzzi…) and the **items** that need looking after in each area. Every item has:
- a **RAG status**: Red = urgent or broken, Amber = needs attention, Green = fine
- a **note** (commentary)
- a **due date**
- an **assignee** (or "Unassigned")
- an optional **repeat** and an optional **push reminder**

People sign in with **Google** and set up a profile with an **emoji** as their avatar. A **Stats** view shows how many tasks each person has done, as a donut chart, for **This Month** or **Lifetime**. Everyone gets a **weekly email** with the full household status, including missed deadlines. **Push notifications** remind people before deadlines and when one is missed.

It replaces a plain notes list the household uses today (see `reference/current-notes-list.png`).

Guiding principle from the client: **radical simplicity.** Do not add filters, counters, dashboards or settings beyond what is described here.

## About the design files
The files in this bundle are **design references made in HTML**: prototypes that show the intended look and behaviour. They are not production code to copy. Recreate them in the target codebase using its own patterns and libraries. If there is no codebase yet, pick the most suitable stack (recommendation below) and build there.

`HomeOS Directions.dc.html` is a design canvas with three rounds of exploration, newest at the top:
- **Turn 3, option 3a: THE CHOSEN DESIGN. Build this one.**
- Turn 2 (2a, 2b) and Turn 1 (1a, 1b, 1c) are earlier explorations, kept for context only.

To view it, open the HTML file in a browser with `support.js` and `ios-frame.jsx` in the same folder. In 3a, the Stats toggle, the emoji picker on Profile, and the confetti on "Mark as Done" all work.

## Fidelity
**High fidelity** for the four screens in 3a (Home, Item, Stats, Profile): final colours, type, spacing and interactions. Recreate them pixel-accurately. Sign-in, household setup and notification settings were not drawn. Build them in the same visual language using native iOS patterns (details below).

## Recommended stack
The household wants push on iPhone without needing the App Store. Two good routes:

1. **Installable web app (PWA). Recommended to start.** Use Next.js or Vite with React and TypeScript, plus Supabase:
   - Supabase Auth handles Google sign-in.
   - Postgres stores the data, with Row Level Security per household.
   - Edge Functions with `pg_cron` run the scheduled jobs.
   - Resend (or Postmark) sends the email.
   - Web Push uses VAPID keys. iOS 16.4 and later supports Web Push, but **only after the user adds the app to the Home Screen**. Add an onboarding step that explains this, and only ask for notification permission after the user taps something.
2. **Native app with Expo (React Native).** Use this if App Store or TestFlight distribution is acceptable. Push goes through Expo Notifications and APNs. Sign-in uses Google via `expo-auth-session`. The backend stays the same.

## Screens / views (all sizes in CSS px / iOS pt, iPhone 402×874 reference)

### Global visual language
- Font: the system font, **SF Pro** (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui`). Use **SF Pro Rounded** (`ui-rounded`) only for big numbers.
- Background `#F2F2F7`. Cards are `#FFFFFF` with no border or shadow. Radius is 24 for list cards and 26 for cards inside sheets.
- Separators: 0.5px `rgba(60,60,67,0.16)`, inset so they start where the text starts. The first row in a card has no separator.
- Primary text `#000000`. Secondary text `#6E6E73`. Tint and actions `#007AFF`. Destructive and missed text `#D70015`.
- Content sits below the status bar: a 54px top inset, then a 52px nav row.
- Scroll-edge fade under the status bar: a 58px band with `linear-gradient(#F2F2F7 55%, transparent)`, non-interactive, above the content.
- Icons are SF Symbols (the prototype uses Material Symbols Rounded as a stand-in): `xmark`, `checkmark`, `plus`.

### Floating tab bar (Home and Stats)
- Pinned 16px from the left and right edges and 22px from the bottom.
- **Left capsule**: 190×62, radius 31, Liquid Glass style.
  - Background `rgba(255,255,255,0.72)` with `backdrop-filter: blur(20px) saturate(180%)`.
  - Border 0.5px `rgba(0,0,0,0.06)`.
  - Shadow `0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08), inset 1.5px 1.5px 1px rgba(255,255,255,.75)`.
  - 4px padding and two equal tabs, **Home** and **Stats**, in 15/600 text.
  - Active tab: background `rgba(0,0,0,0.06)`, radius 27, text `#007AFF`. Inactive tab: text `#1C1C1E`.
- **Right add button**: a 62px circle in `#007AFF` with a white plus at about 32px. Shadow `0 6px 18px rgba(0,122,255,0.35)`. Tapping it opens a new-item sheet.
- In a native build, use the system tab bar and a toolbar button if they come close to this look.

### 1. Home
- **Nav row** (52px tall, 0 16px padding): the profile avatar on the right, 38px. The avatar is a circle in `#E5E5EA` with the user's emoji at 22px. Tapping it opens Profile.
- **Title block** (0 20px padding, 2px gap):
  - "Home": 34px, line-height 41, weight 700, letter-spacing −0.02em.
  - "21 Alderbrook Road": 17px, −0.4px, `#6E6E73`. This is the household address field.
- **Home scene card** (16px padding around, 150px tall, radius 24, overflow hidden). It shows a duck and a hedgehog living in a house.
  - Background: sky and grass split at 66%: `linear-gradient(#EAF3FF 0%, #F6FAFF 66%, #DCEFD6 66%, #CFE8C8 100%)`.
  - Sun: a 28px circle in `#FFD66B` with a 9px halo of `rgba(255,214,107,0.22)`, 22px from the top and 28px from the right.
  - 🏡 at 88px, centred horizontally, 30px from the bottom.
  - 🦆 at 40px, left edge at `calc(50% − 102px)`, 16px from the bottom. It loops between `translateY(0) rotate(−3deg)` and `translateY(−5px) rotate(3deg)`, 850ms, alternating, ease-in-out.
  - 🦔 at 38px, left edge at `calc(50% + 60px)`, 16px from the bottom. It loops between `rotate(−5deg)` and `rotate(5deg)`, 1300ms, alternating, ease-in-out.
  - Respect *Reduce Motion*: the animals stay still when it is on.
  - A commissioned illustration can replace the emoji later. Keep the same placement.
- **Area sections**, in the household's own order:
  - Header: area name at 20px, line-height 25, weight 600, −0.3px. Padding 24 20 8.
  - Then a white card (margin 0 16, radius 24) with one row per open item.
  - An empty area shows a single row, "Nothing to do", in 17px `#6E6E73`, with padding 13 18.
- **Item row** (padding 0 18 0 16, 14px gap):
  - **Status ring**: 22px circle, 2px border, 13px top margin.
    - Red: border `#FF3B30`, fill `rgba(255,59,48,.12)`.
    - Amber: border `#FF9500`, fill `rgba(255,149,0,.14)`.
    - Green: border `#34C759`, fill `rgba(52,199,89,.14)`.
    - Tapping the ring marks the item done. This also fires the confetti (see below).
  - **Content column**: padding 12 0 13, 2px gap. The separator sits on its top edge.
    - Title: 17/22, weight 400, −0.4px.
    - Note (only if there is one): 15/20, −0.2px, `#6E6E73`, cut off at **2 lines**.
    - Meta line: 13px `#6E6E73`, 3px top margin, in the form `🦆 Shea · Tue 20 Oct`.
      - If unassigned: `Unassigned · Tue 20 Oct`.
      - If missed: the date part becomes `Missed · Tue 6 Oct` in `#D70015`, weight 700.
  - Tapping the row (but not the ring) opens the Item sheet.
- Sort items within an area by due date, earliest first. Items with no date go last.

### 2. Item sheet (edit / new)
- **Presentation**: an iOS page sheet. Top edge at 62px, top corner radius 38, background `#F2F2F7`. The screen behind is black with a peek card: `#BDBDC2`, 50px from the top, inset 18px left and right, 40px tall, top radius 14. Natively, use `.sheet` with the large detent.
- **Nav** (padding 14 16 6), using a 44 / 1fr / 44 grid:
  - Left: close button. A 44px white circle with shadow `0 1px 3px rgba(0,0,0,.08)` and an xmark at 22px in `#1C1C1E`. Closes without saving.
  - Right: save button. A 44px circle in `#007AFF` with a white checkmark at 24px. Saves and closes.
- **Body** (padding 14 16 40, scrollable, 20px gap between blocks):
  1. **Title and note**, with no card, padding 0 4.
     - Title: 28/34, weight 700, −0.02em, editable.
     - Note: 17/23, −0.3px, `#6E6E73`, a multiline editable field.
     - Placeholders: "Title" and "Add a note".
  2. **RAG picker**: a white card (radius 26, padding 7) with three equal options, 6px gap. Each option is 52px tall, radius 20, with a 12px dot and a label in 17px: **Red**, **Amber**, **Green**.
     - Selected option: tinted background in its own colour (red `rgba(255,59,48,.10)`) and weight 600. The text colour is the darker accessible tone: red `#D70015`, amber `#C93400`, green `#248A3D`.
     - Unselected options: transparent background, text `#3C3C43`.
  3. **Details card**: white, radius 26, padding 0 18. Rows are at least 52px tall, with the label on the left and the value on the right (17px, value in `#6E6E73`):
     - **Due**: a date picker. If missed, the value reads `Tue 6 Oct · 2 days late` in `#D70015`.
     - **Assigned to**: shows `emoji + name`, or "Unassigned". Opens a list of household members plus "Unassigned".
     - **Repeat**: Never, Weekly, Monthly, Every 3 months, Every 6 months, Yearly.
     - **Notify**: None, On the day, 1 day before (default), 1 week before. This is a push reminder.
  4. **Mark as Done**: 54px tall, radius 27, `#007AFF`, white 17/600 text. On press it scales to 0.96 over 120ms. Then it fires the confetti, completes the item, and dismisses the sheet after about 600ms so the burst can be seen.
  5. **Delete**: centred 17px `#D70015` text button. Ask for confirmation in an action sheet.
- **New item**: open the same sheet with the area preselected (the area you added from, otherwise the first area), status Amber, due in 7 days, Unassigned, Repeat Never, Notify 1 day before. Hide Mark as Done and Delete. Save is disabled until the title is filled in.

### 3. Stats
- Nav row with the avatar, then the title "Stats" (34/41/700).
- **Segmented control** (margin 18 16 0): track `rgba(118,118,128,0.12)`, fully rounded (radius 100), 3px padding. Two 38px segments, **This Month** and **Lifetime**, in 15px text.
  - Selected segment: white, shadow `0 3px 8px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)`, weight 600.
  - Unselected segment: weight 500.
- **Donut** (centred, padding 36 0 32): 220px across, stroke 26, **round caps**, **9px visual gap** between segments. It starts at 12 o'clock and runs clockwise, one segment per member in member order, coloured with each member's colour.
  - Centre: the total in 54px SF Pro Rounded, weight 700, then "done" in 15px `#6E6E73`.
  - Arc maths used in the prototype: `C = 2πr`. Each segment has dash `len = share·C − gap − stroke`, offset `−(start·C + (gap+stroke)/2)`, and the SVG is rotated −90°.
- **Legend card** (white, radius 24, padding 0 18), one row per member, rows at least 52px:
  - Avatar: a 36px circle in `#F2F2F7` with an inset 2.5px ring in the member's colour and the emoji at 20px.
  - Then the name in 17px, and the count on the right in 17/600.
- **Counting rule**: a completion counts for the item's assignee at the moment it was completed. If the item was unassigned, it counts for the person who marked it done. This Month means the current calendar month in the household's time zone.
- Member colours, assigned in join order: `#007AFF`, `#AF52DE`, `#30B0C7`, then `#FF9500`, `#34C759`, `#FF2D55`. Avoid red, amber and green when there are fewer than four people.

### 4. Profile (opened from the avatar)
- "Done" in 17/600 `#007AFF` at the top right.
- Avatar: a 112px white circle with shadow `0 2px 12px rgba(0,0,0,.06)` and the emoji at 62px. Below it, the name at 28/34/700 (from Google, editable) and "Signed in with Google" in 15px `#6E6E73`.
- "Your emoji" heading (20/600, padding 30 20 8). Below it, a grid card: white, radius 24, padding 10, **6 columns**, 4px gap. Cells are 52px tall, radius 16, with the emoji at 30px.
  - Selected cell: background `rgba(0,122,255,.10)` and an inset 2.5px `#007AFF` ring.
  - Caption below the card: "Shown next to your name on items and in Stats." in 13px `#6E6E73`.
- Emoji set (24): 🦔 🦆 🦊 🐻 🐼 🐨 🐸 🐢 🐙 🦉 🐝 🦋 🐱 🐶 🐰 🦁 🐧 🐳 🌻 🌵 🍄 🌈 ⭐ 🔥
- Add these rows below the grid. They were not drawn, so use the same white-card row style:
  - Weekly email (on/off)
  - Push notifications (on/off, with the "Add to Home Screen" hint for the PWA)
  - Invite someone (share link)
  - Sign out

### 5. Sign-in and setup (not drawn; build in the same style)
1. **Welcome**: the home scene card, the HomeOS name, and a "Continue with Google" button. Follow Google's sign-in branding guidelines.
2. **First sign-in**: create your profile. The name comes pre-filled from Google. Pick an emoji from the same grid.
3. **Household**: if the user arrived from an invite link, join that household. Otherwise create one by entering a name and an address, then add areas. Seed the default areas listed below.

## Interactions & behaviour
- **Missed**: an item is missed when it is still open and its due date is before today, in the household's time zone. Missed items show red text (see the Home and Item screens) and are listed first in the weekly email.
- **Done**:
  1. Log a completion `{item_id, credited_to, completed_by, completed_at}`.
  2. If the item repeats, keep it open and move the due date forward by one interval from the old due date. If that date is still in the past, step forward from today instead. Otherwise mark the item done, which hides it from Home.
  3. Show an undo toast for about 4s.
- **Confetti: hedgehogs and ducks**. It fires on Mark as Done and on tapping a status ring.
  - 36 particles, each one randomly 🦔 or 🦆, sized 24–44px.
  - Origin: the centre of the control that was tapped.
  - Velocity: horizontal speed is uniform random within ±280 px/s. Vertical speed is −(700 to 1200) px/s, so upwards. Gravity is 1500 px/s².
  - Spin: ±420° over the particle's life.
  - Duration 1.7–2.6s, start delay 0–160ms.
  - Scale goes from 0.2 to 1 in the first frame. Opacity is 1 until 75% of the duration, then fades to 0.
  - Draw it as a full-screen overlay above everything that does not take taps. Remove it after about 3s.
  - Add a success haptic in a native build. With *Reduce Motion* on, show a single small burst or skip it.
- **Sheet**: standard iOS sheet animation, swipe down to dismiss. Ask before discarding unsaved changes on a new item.
- **Edits**: store `updated_by` and `updated_at` on each item. A "Last updated … by …" line can be added later if wanted.

## Notifications
- **Weekly email**: one email per member, sent to everyone with the same content: the **full household status**. Default send time is Monday 08:00 in the household's time zone, and each member can switch it off. Content, in order:
  1. Missed deadlines (title, area, assignee, days late)
  2. Due in the next 7 days
  3. Everything else open, grouped by area with RAG
  4. Unassigned items
  5. Done this week per person
  6. A button that opens HomeOS
- **Push**:
  - Reminder per the item's **Notify** setting. It goes to the assignee, or to everyone if the item is unassigned.
  - A **missed alert** the morning after the deadline passes, sent to the assignee and the household owner.
  - Run a scheduled job every 15 minutes or so to find what needs to be sent, and store what has been sent so nothing goes out twice.

## State management and data model
```
households   id, name, address ("21 Alderbrook Road"), timezone, weekly_email_day, weekly_email_time
members      id, household_id, user_id (Google), name, email, emoji, color, role (owner|member),
             weekly_email (bool), push_enabled (bool)
push_subs    id, member_id, endpoint, keys (Web Push)  |  expo_token (native)
areas        id, household_id, name, position
items        id, area_id, title, note, rag (red|amber|green), due_date (date, nullable),
             assignee_id (nullable), repeat (none|weekly|monthly|quarterly|biannual|yearly),
             notify (none|same_day|day_before|week_before), status (open|done),
             created_by, updated_by, updated_at
completions  id, item_id, credited_to, completed_by, completed_at
invites      id, household_id, token, created_by, expires_at
notifications_log  id, item_id, member_id, kind (reminder|missed|weekly), sent_at
```
Client UI state: current tab (home or stats), the open sheet (edit with an item id, or new with an area id), the Stats period (month or lifetime), and the undo toast.

## Design tokens
- **Colours**
  - Background `#F2F2F7` · card `#FFFFFF` · avatar background `#E5E5EA`
  - Label `#000000` · secondary label `#6E6E73` · tertiary label `#3C3C43` · separator `rgba(60,60,67,0.16)`
  - Tint `#007AFF` · destructive and missed `#D70015`
  - RAG rings `#FF3B30` / `#FF9500` / `#34C759`
  - RAG tints `rgba(255,59,48,.12)` / `rgba(255,149,0,.14)` / `rgba(52,199,89,.14)`
  - RAG text `#D70015` / `#C93400` / `#248A3D`
  - Members `#007AFF` · `#AF52DE` · `#30B0C7` (then `#FF9500` · `#34C759` · `#FF2D55`)
- **Type** (SF Pro, size / line-height / weight / tracking)
  - Large title 34/41/700/−0.02em
  - Sheet title 28/34/700/−0.02em
  - Section header 20/25/600/−0.3px
  - Body 17/22/400/−0.4px
  - Subhead 15/20/400/−0.2px
  - Footnote 13/16/400
  - Tab label 15/600
  - Stat number 54 SF Pro Rounded 700
- **Radii**: 16 (emoji cell), 20 (RAG option), 24 (list card, scene), 26 (sheet card), 27 (button), 31 (tab capsule), 38 (sheet), full circle.
- **Spacing**: 16 card side margin · 20 title side padding · 24 above each area header · 8 below it · 52 minimum row height · 44 minimum tap target.
- **Shadows**: glass `0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)` · add button `0 6px 18px rgba(0,122,255,.35)` · segment `0 3px 8px rgba(0,0,0,.12)`.

## Seed data (from the client)
- **Areas**, in this order: Kitchen, Living Room, Bathroom Small, Bathroom Large, Bedroom Small, Bedroom Large, Garden, Garden Lounge, Jacuzzi, Hallway, Front garden.
- **People**: Stratis (owner, 🦔), Shea (🦆), Ela (🦊).
- **Example items**, taken from the client's notes:
  - Kitchen paper and Olive oil (green, repeat monthly)
  - Mirror lights not level (amber, Living Room, "One is 3cm higher. We need to bring someone in to make it even.")
  - Garden room wall panel (amber, "Solved for now, but the solution is not the most elegant.")
  - Give away the old firepit (green, Ela)
  - Heaters not working (red, Shea)
  - The full list is in the `areas` array in the prototype's logic class.

## Assets
There are no image files. The avatars, confetti and home scene all use system emoji (Apple Color Emoji on iPhone).

> **Built app (follow-up round):** at the household's request the app draws the duck (green) and the hedgehog (brown) as small inline SVGs (`src/ui/animals.ts`) for the home scene and the confetti, in the same places and with the same motion. The house is still the 🏡 emoji and the avatars are still emoji. The scene's sky also follows the time of day in London (see `docs/ARCHITECTURE.md`, "Home scene"); by day it is the 3a scene above. Icons are SF Symbols natively; the prototype uses Material Symbols Rounded from Google Fonts as a stand-in. The phone frame (`ios-frame.jsx`) is only for presentation.

## Files
- `HomeOS Directions.dc.html`: the design canvas. **Turn 3 / 3a is the spec.**
- `support.js`, `ios-frame.jsx`: needed to open the canvas in a browser.
- `reference/current-notes-list.png`: the notes list the household uses today.
