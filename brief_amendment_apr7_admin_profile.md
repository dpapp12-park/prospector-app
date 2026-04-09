# Brief Amendment - Admin Planning + Dashboard Profile/Alerts Session
## Date: April 7, 2026
## Session type: Planning + Schema setup + Dashboard build/polish

Append this block to the Session Log in `Prospector_Master_Brief_v4.md`.

---

## 1) Super Admin Dashboard (Pre-build) - Decisions Locked

### Admin location and access
- Admin page path confirmed: `admin/index.html` (URL: `/admin/`).
- Security model confirmed: Supabase role check via `admin_users` table is the primary lock.
- URL obscurity is secondary; do not publicly reference admin URL.

### Admin dashboard tabs (final)
1. Overview
2. Users
3. Feature Flags
4. Pipeline
5. AI Costs
6. Notifications
7. Analytics (standalone tab, not folded into Overview)

### Users tab capabilities (confirmed)
- Search/view user profiles.
- Change tier manually.
- Add internal notes.
- Ban/unban.
- View per-user AI usage/cost.
- Password recovery should be self-serve ("Forgot password"), not admin-managed manual resets.

### Notifications system (final design)
- Notification targets: both broadcast and targeted users.
- Surfaces: bell icon with unread dot + notifications tab in user dashboard.
- Supports formatting, preview before send, draft + schedule.
- Notification types:
  - `permanent`: stays until user dismisses.
  - `timed`: auto-expires on admin-set date.
  - `persistent`: always available (changelog style).
- Starter templates confirmed:
  1. Feature Announcement
  2. Data Update
  3. Tip of the Week
  4. Promotion / Offer
  5. System Notice

### Analytics direction (final)
- Build product analytics in Supabase (first-party ownership).
- Use Plausible only for landing-page marketing traffic.
- Consent/privacy posture:
  - First-visit consent banner before tracking.
  - Privacy policy page (plain English).
  - Analytics opt-out toggle in user profile.
- Capture model: full capture.
- Retention model: 90-day semi-purge with permanent monthly rollups.
  - Raw events pruned after 90 days.
  - Aggregates preserved in `analytics_summaries`.

### User-facing analytics decision
- Add a future `My Activity` tab in user dashboard.
- Include personal analytics and a Gold Bank calculator.
- Gold Bank concept confirmed:
  - Lifetime value of finds at current gold price.
  - Daily/monthly/yearly totals.
  - "Best day" style milestone moments.
  - Optional "price at find time vs today" comparison.

### AI limits and credit model (final)
- AI usage must be tier-limited (exact limits intentionally parked in config).
- Limits should be adjustable without code deploy.
- Add paid top-up credits when users hit limit.
- Payment processor direction: Stripe backend with Google Pay/Apple Pay checkout options.
- Credit-pack pricing parked for Stripe build session.

---

## 2) Supabase Schema Work Completed In Session

All required tables for admin/notifications/analytics/AI credits were created and validated in this session:

- `admin_users`
- `ai_cost_log`
- `ai_credits`
- `notification_templates`
- `notifications`
- `notification_reads`
- `sessions`
- `map_events`
- `feature_events`
- `error_log`
- `analytics_summaries`

Additional outcomes:
- RLS enabled across operational tables.
- Policies created for user-safe insert/read behavior where needed.
- `analytics_summaries` RLS enabled.
- Admin user inserted:
  - `beb4131b-b511-4acb-b565-d39a8858ade1`

Folder setup:
- `admin/` folder created in project for future admin dashboard implementation.

---

## 3) Dashboard Build - Profile + Alerts Work Captured

### Infrastructure / alerts outcomes captured
- Domain and alert infrastructure context recorded as complete in this phase.
- Claim-monitoring alert workflow finalized (status/expiry/nearby logic and preferences model).
- Profile alerts preferences represented in `user_profiles` strategy.

### Profile UX build outcomes
- Two-column profile layout implemented:
  - Left: profile/edit interactions.
  - Right: snapshot/info cards.
- Read-only profile view compacted into borderless, tighter layout.
- Edit mode reworked to tabbed sections:
  - Identity
  - Location
  - Preferences
- Edit-mode visual state improved with clear highlight border.
- Home state handling expanded to all 50 states (JS-generated options).
- Prospecting states chip picker added (add/remove state chips).
- `prospect_states` load/save flow wired.
- Header/display name consistency improved to use saved display name when available.
- Greeting behavior fixed to update on page load after profile data hydrates (not only on profile-tab click).

---

## 4) Known Follow-ups / Parking Lot

- Profile image upload (requires Supabase Storage setup).
- Optional custom iconography for toggles (gold nugget ON / stay-out OFF).
- Finalize exact AI tier limits and credit pack pricing during Stripe/payment build.
- Build `admin/index.html` implementation pass using the now-complete schema and planning decisions.

---

## 5) Suggested Commit Message (for this brief amendment)

`Add Apr 7 admin planning and profile/alerts amendment`

