# Server setup wizard

The setup wizard provisions the GYNX Discord server from the official blueprint
(`packages/services/src/setup/blueprint.ts`): roles, categories and channels
with emoji names, permissions, the welcome/rules/verify messages, the public
support status panel, the private staff duty-control panel, log/alert routing
and an announcement template. It can be run again at any time and only does
what is missing.

## Running it

Who can run it: anyone with the `setup.manage` bot permission (the server owner
always has it). Every service call checks the permission itself; denials are
audited.

| Command           | Dashboard                                                | What it does                                                     |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `/setup preview`  | Server setup → Overview, **Preview setup**               | Shows what a START would do. Changes nothing.                    |
| `/setup start`    | Server setup → Overview, **Preview setup**, then Confirm | First provisioning, or resume after a partial run.               |
| `/setup status`   | Server setup → Overview                                  | Completion %, per role/channel/panel state, permission findings. |
| `/setup repair`   | Server setup → Overview, **Repair**                      | Restores renamed or deleted managed resources and lost panels.   |
| `/setup update`   | Server setup → Overview, **Update**                      | Applies blueprint/config changes (e.g. role permissions).        |
| `/setup rollback` | Server setup → History, **Preview rollback**             | Reverts one operation (default: the latest applied one).         |

Every operation is **preview → confirm → run**:

1. A preview is stored as a `SetupOperation` (PREVIEWED) with the plan and a hash
   of its changes.
2. Confirming re-reads the live server and re-plans. If anything differs, the
   preview is **stale**: it is cancelled and a fresh preview is returned instead.
3. Changes marked **disruptive** (they touch something members already use)
   need explicit consent (`acceptDisruptive`).
4. The worker job `setup.apply` executes the operation. Only one operation per
   server can be queued or running at a time.

Customisation (`GuildSetup.configuration`, dashboard → Server setup → Configuration):
role names/colours, channel and category names, which components to manage,
channels to leave out, slow mode per channel, which staff roles may see each
restricted channel.

## What it changes

- **Roles** (Founder … Bot) with minimal guild permissions, ordered in blueprint
  order directly below the bot's role. New roles get the blueprint colour,
  permissions, hoist and mentionable settings.
- **Categories and channels**, categories first. Each is created with its
  permission overwrites already set, so a private area is never visible, not
  even briefly. Channels get only the overwrites that differ from their category
  (e.g. read-only `events`, chat in `troubleshooting`, restricted staff channels
  that deny View Channel to staff roles not designated for them).
- **Routing** (component "logging"): GuildConfig/WelcomeConfig channel and role
  fields (mod log, alerts, status board, suggestions, events, setup log, staff
  ping role, verified role …). Setting the verified role also turns on member
  verification; that is shown as disruptive.
- **Dashboard grants** (component "staff-grants"): each staff role gets its
  bot permission preset, but only presets the confirming admin holds
  themselves. Others are listed as manual steps.
- **Messages**: welcome, rules (the rules text from the welcome settings) and
  verify (Accept rules / Verify buttons handled by the community module); the
  public support status panel (availability only, no ticket controls); the
  private duty-control panel. Each is posted once and recorded.
- **Announcement template** "Official announcement" (saved only, never posted).
- A short summary (counts, operation id, who ran it) is posted to the setup log
  channel (`🧾・audit-logs`). No secrets or server details are posted.

## Safety guarantees

- **Never guesses.** A pre-existing role/category/channel that is not in the
  manifest is adopted only when exactly one resource matches (roles: same name,
  not an integration role; categories: same name; channels: same name,
  compatible type and, when the category exists, inside it). Several matches →
  `ambiguous-match` finding, nothing adopted, nothing created.
- **Adopted resources are never deleted**, and an adopted role's permissions are
  only changed by an UPDATE, as a disruptive change.
- **Unrelated roles, channels and overwrites are never touched.** Overwrites are
  written one target at a time, only for targets the blueprint manages.
- **Never deletes to rename.** Renames are edits of the same channel/role.
- **Role hierarchy.** Roles at or above the bot's highest role are never
  edited or reordered (`hierarchy` finding for that role).
- **The bot never grants permissions it lacks.** They are stripped from the
  plan with a `cannot-grant` finding.
- **No exposure / lockout.** No plan ever allows @everyone to view a private
  area, and the owner is never denied. Verification re-checks both.
- **Preflight.** Missing Manage Roles or Manage Channels blocks the operation;
  other missing bot permissions are listed.
- **Failures.** Rate limits (429, honouring `retry_after`), 5xx and network
  errors are retried up to 3 times with exponential backoff and jitter.
  Permission/validation errors (403/50013/50001/400) fail that change only;
  independent changes continue and dependants (a channel in a failed category,
  an overwrite on a failed channel) are skipped with the reason. The result is
  checkpointed after every stage; the operation ends PARTIAL and a new START (or
  a worker retry of the same operation) resumes without duplicates.
- **Verification** after every run: every managed resource exists with its
  name; private areas deny @everyone and only blueprint roles are allowed in;
  restricted channels deny non-designated staff; the bot can see/post where it
  posts; panels exist. The setup is COMPLETE only when verification passes.

## Repair, update and rollback

- **START** creates only what was never created. A managed resource that was
  renamed or deleted after setup is reported (`renamed` / `deleted`), not
  changed.
- **REPAIR** restores names, moves channels back into their category, restores
  topic/slow mode and managed overwrites, recreates deleted resources and
  re-posts missing messages (only the missing one).
- **UPDATE** does what REPAIR does and also applies colour/permission changes
  to adopted roles (disruptive).
- **ROLLBACK** reverts only the changes APPLIED by the chosen operation:
  - created channels/roles are deleted only if they still exist; a channel that
    contains member messages is kept ("contains member messages"), and so is a
    category that still holds channels;
  - adopted resources only leave the manifest; they are never deleted;
  - renames, moves, slow mode, overwrites and routing are restored to the
    recorded previous value; overwrites the operation added are removed;
  - messages the operation posted, grants it added and the template are removed;
  - role order is not reverted.

## Manual steps

- **Bot role position.** Drag the bot's role above every role it should manage
  (Server Settings → Roles). Roles above it are reported and left alone.
- **Founder.** The bot never holds Administrator, so it cannot grant it. If you
  want Founder to have Administrator, grant it manually; if Founder should
  outrank the bot, drag it above the bot's role afterwards (the setup then stops
  managing it).
- **Dashboard presets you cannot grant** (e.g. OWNER) must be granted by someone
  who holds them, in Settings → Permissions.

## Manual test plan (dedicated test guild)

Use a throwaway guild; never test against the production server.

1. Invite the bot with Manage Roles, Manage Channels and the blueprint
   permissions (no Administrator). Put its role at the top.
2. Create an unrelated role and channel with a custom overwrite; note them.
3. `/setup preview` → check counts, findings, disruptive list. Nothing changes.
4. `/setup start` → confirm with disruptive consent. Check: roles in order below
   the bot; all channels with emoji names in the right categories; as a member
   without roles you only see START HERE, GYNX HOSTING, SUPPORT CENTER and the
   verify flow; staff areas are invisible; support status and duty panels are
   posted once; a summary appears in `🧾・audit-logs`; the unrelated role,
   channel and overwrite are unchanged.
5. `/setup start` again → no changes.
6. Rename `🔧・troubleshooting` and delete `💬・general` → `/setup status` shows
   renamed/missing; `/setup start` does not fix them; `/setup repair` renames
   the same channel and recreates `💬・general`.
7. Delete the support status panel message → `/setup repair` re-posts only it.
8. Remove Manage Channels from the bot → preview is blocked. Restore it.
9. Post as a member in a created channel → `/setup rollback` keeps that channel
   (and its category), deletes the other created resources, keeps adopted and
   unrelated ones, and restores routing.
