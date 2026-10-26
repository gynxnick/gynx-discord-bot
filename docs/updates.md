# Update feed (GitHub → Discord)

When code is pushed to a tracked GYNX repository (website, panels, …) the bot posts an update:

| Where                                                       | What                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Staff channel** (private, "Update feed (staff, private)") | Every push to the tracked branch: up to 5 commits (short hash, first line, author), "+N more", the pusher and a compare link. Every published release, including pre-releases. |
| **Public channel** ("Update feed")                          | Only published releases (not pre-releases) and the `[public]`-tagged lines of commit messages. No hashes, authors, branch names or compare links.                              |

Pushes to other branches, tag pushes, branch deletions and empty pushes are ignored. Draft releases and release actions other than `published` are ignored.

## Setup

### 1. Server: the webhook secret

GitHub signs every delivery with a shared secret. The dashboard reads it from `GITHUB_WEBHOOK_SECRET`; while it is unset, `POST /api/webhooks/github` answers **503** and the dashboard page says so.

- **VPS installs:** `install.sh` generates one (only if none is set yet) and prints it at the end. Show it again, with the other webhook settings, with:
  ```bash
  sudo gynx github-webhook
  ```
  (This also creates the secret if it is missing and restarts the dashboard.)
- **Set or rotate it yourself:**
  ```bash
  openssl rand -hex 32          # copy the output
  sudo gynx set GITHUB_WEBHOOK_SECRET   # paste it (input is hidden)
  ```
  After rotating, update the secret on every repository's webhook.
- **Other platforms:** set `GITHUB_WEBHOOK_SECRET` on the dashboard (see `.env.example`).

### 2. Discord: channels

Dashboard → **Settings → General → Channels** (or `/config channel set`):

- **Update feed**: the public updates channel (e.g. `#updates`, read-only for members).
- **Update feed (staff, private)**: a staff-only channel. It can't be the same channel as a public one.

A channel that isn't set is skipped. The bot needs **View Channel**, **Send Messages** and **Embed Links** there. If it can't post, the delivery shows "Bot cannot post" on the dashboard and is not retried.

The module **Update feed (GitHub)** must be enabled in Settings → General → Modules (it is on by default).

### 3. Dashboard: tracked repositories

Dashboard → **Status & incidents → Update feed** → **Add repository** (needs the `updates.manage` permission, which owners and administrators have):

- **GitHub repository**: `owner/repo`, e.g. `gynx-gg/website`.
- **Display name**: shown in posts, e.g. "Website" or "Game panel".
- **Colour**: embed colour.
- **Tracked branch**: leave empty to use the repository's default branch.
- **Enabled**: when off, the repository's webhooks are ignored.
- **Post tagged updates publicly**: when off, everything from this repository stays in the staff channel.

Webhooks from repositories that aren't listed (or are switched off) are ignored with `202`.

### 4. GitHub: add the webhook (per repository)

1. Open the repository on GitHub → **Settings** → **Webhooks** → **Add webhook** (you need admin access to the repository; for many repositories you can add one organisation webhook instead under the organisation's **Settings → Webhooks**).
2. **Payload URL**: `https://<your dashboard domain>/api/webhooks/github` (shown with a copy button on the dashboard page).
3. **Content type**: `application/json`.
4. **Secret**: the value of `GITHUB_WEBHOOK_SECRET` on the server.
5. **SSL verification**: leave enabled.
6. **Which events would you like to trigger this webhook?** → **Let me select individual events** → tick **Pushes** and **Releases**, untick everything else (including "Pull requests").
7. **Active**: ticked → **Add webhook**.

GitHub immediately sends a `ping`; the webhook's **Recent Deliveries** tab should show `200`. Push a commit to the tracked branch: the dashboard's **Recent deliveries** list shows it, and the staff channel gets a post within seconds.

## The `[public]` tag

Commit messages are internal by default. To announce a change, put `[public]` (any case) on the line that should be shown publicly. The public post lists that line only, with the tag (and a trailing `(#12)` PR reference) removed.

| Commit message                                                                                                                          | Public line            |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `Faster server start-up [public] (#12)` (squash merge)                                                                                  | Faster server start-up |
| `Merge pull request #12 from gynx-gg/fast-start` + body line `New: one-click backups [PUBLIC]` (merge commit; the body is the PR title) | New: one-click backups |
| `Fix login redirect` + a line with only `[public]`                                                                                      | Fix login redirect     |
| `Refactor session store` (no tag)                                                                                                       | (nothing: staff only)  |

So the easiest habit: put `[public]` in the **pull request title** when the change is worth announcing. Pushes without any tagged commit are posted to staff only. Identical lines in one push are listed once. Published releases are always public (unless the repository's public switch is off) with their release notes; pre-releases go to staff only.

## Wording

All titles, labels and line formats are editable in Dashboard → Settings → **Bot text** (namespace `updates`).

## Security notes

- The endpoint has no session or CSRF check by design; it is authenticated **only** by the `X-Hub-Signature-256` HMAC-SHA256 signature, compared in constant time. Missing or wrong signatures get `401`. The secret is never shown in the dashboard or logged, and request bodies are never logged.
- Bodies over 1 MB are rejected (`413`) and requests are rate limited per IP (`429`).
- Every delivery is stored once by its `X-GitHub-Delivery` id: GitHub redeliveries return `200` "duplicate" and post nothing. Posted message ids are stored, so a worker retry never posts twice.
- Commit messages, author names and release notes are passed through the same secret redaction as diagnostics (tokens, keys, credentials, emails, IPs → `[REDACTED]`) before they are stored or posted, in the staff channel too. Mentions are disabled on every post.
- Raw commit messages never reach the public channel: it only ever receives release notes or the tagged lines.
- Rotate the secret if it leaks (`gynx set GITHUB_WEBHOOK_SECRET`, then update each webhook). Repository and channel changes are written to the audit log.
