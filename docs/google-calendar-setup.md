# Google Calendar sync — one-time setup

> This is the hands-on-Google step that turns on Phase 6C. Until it's done,
> the Ops calendar works fully on its own (local-only); sync is dormant and
> every Google hook is a silent no-op. ~15 minutes, done once.
>
> You picked the **service-account + domain-wide delegation** model (set-and-
> forget — no login to maintain, no token that expires and needs
> reconnecting). That's what these steps configure.

## What you'll end up with

Four environment variables in Ops (Vercel project settings, and `.env.local`
if you want sync in dev):

```
GOOGLE_SA_CLIENT_EMAIL    ops-sync@<project>.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY     -----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n
GOOGLE_IMPERSONATE_EMAIL  dean@sharpsightedstudio.com
GOOGLE_CALENDAR_ID        (optional — leave unset to auto-create "Sharp Sighted")
```

When all three of the first vars are present, `calendarSyncConfigured()`
flips true and sync activates on the next block create/edit/delete.

## Steps

### 1. Create a Google Cloud project + service account
1. Go to <https://console.cloud.google.com> → create a project (e.g.
   `sharp-sighted-ops`).
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Name it `ops-sync`. No roles needed. Create.
4. Open the new service account → **Keys → Add key → Create new key → JSON.**
   A `.json` file downloads. Inside it are `client_email` and `private_key` —
   those become `GOOGLE_SA_CLIENT_EMAIL` and `GOOGLE_SA_PRIVATE_KEY`.
5. On the service-account detail page, copy its **Unique ID / Client ID** (a
   long number) — you need it in step 2.

### 2. Authorize domain-wide delegation (the Workspace admin step)
1. Go to <https://admin.google.com> (you're the Workspace admin).
2. **Security → Access and data control → API controls → Manage
   Domain-Wide Delegation.**
3. **Add new.** Client ID = the service account's Unique ID from step 1.5.
   OAuth scope:
   ```
   https://www.googleapis.com/auth/calendar
   ```
4. Authorize. This is what lets the service account act *as you*
   (`GOOGLE_IMPERSONATE_EMAIL`) on your calendars.

### 3. Put the vars in Ops
- **Production:** Vercel → the Ops project → Settings → Environment
  Variables. Add the four. For `GOOGLE_SA_PRIVATE_KEY`, paste the PEM exactly
  as it appears in the JSON (the `\n` escapes are fine — Ops un-escapes them).
- **Local (optional):** add the same to `.env.local`. Remember the dev-env
  guard — `npm run dev` reads `.env.local`.
- Redeploy (prod) or restart `npm run dev` (local) so the vars load.

### 4. First run
- Leave `GOOGLE_CALENDAR_ID` unset and Ops will **find-or-create a calendar
  named "Sharp Sighted"** in your Workspace on the first synced write, and
  remember its id. (Or set the var to an existing calendar's id to use that.)
- Create or edit a block in Ops. Within a moment it appears on the
  "Sharp Sighted" calendar in Google — on your phone, your laptop, anywhere
  you see that calendar. Toggle the calendar's visibility in Google to
  show/hide the whole Ops layer without touching personal events.

## What's synced, and which direction (as of 6C-1)

- **Ops → Google (outbound): live.** Create / edit / delete a block in Ops
  and the matching Google event is created / patched / deleted. Recurrence
  (your "every Tuesday") rides along as a native Google recurring event.
- **Google → Ops (inbound): Phase 6C-2.** Editing an event *in Google* and
  having it flow back to Ops — plus the push-notification webhook and the
  conflict rule — is the next sub-phase. Until then, treat Ops as the place
  you author; Google is the mirror you read on your phone.

## If something looks off

- A block stuck with a red/error state in Ops means a Google write failed —
  the local block is fine; check the Vercel function logs for the Google
  error text (auth, quota, or scope are the usual causes).
- "Token exchange failed" → re-check step 2 (the Client ID + scope must match
  exactly) and that the Calendar API is enabled (step 1.2).
- Quota note: under domain-wide delegation the service account is charged
  per-user quota. Ops batches and backs off; normal solo use is nowhere near
  the limit.

---

*Stay Sharp. Stay Seen. Stay Human.*
