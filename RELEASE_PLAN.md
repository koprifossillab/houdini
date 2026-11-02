# PaleoLab Houdini UI release candidate — 2026-11-02

## Scope and gates
Candidate version: 0.1.4-rc.1 (candidate label, not a deployed release).
Production base: 456c3d5fb1b74a784bbcca6f8f40df9563cffe53 / operating image 0.1.2.
Separate Work worktree: houdini-work-ui-release, branch work/20261102-work-ui-release.
Production Link 93faea2 is NOT included. Its independent re-review result has not been confirmed. The new UI is isolated from its jobs API, collector, permission and media-cache changes. A later PASS does not automatically merge it: use a separate reviewed integration commit and rerun integration checks.

## Changes
Default light research-lab palette, optional dark mode; A–D scene review under the existing preview tab. Existing overview, approval records, reports, lab, health and historical media remain. Existing lib modules, records and browser app.js are unchanged. Only two static resources join the existing protected asset router. Scene registration is empty: no fictional images, PC captures or physical PASS are supplied.
The scene manifest is a curated public-safe presentation file, not a raw producer record. Do not put original paths, raw research data or logs in it. Existing authentication/network policy and media allowlist are unchanged. There is no new observer, cron job or compute launcher.

## Real media readiness
Known producer branch 8292ed7 supplies preview-only P1, not a physical solver. A–D represent time segments of one sequence. A=1–36, B=36–120, C=120–180, D=180–240; front and 3/4 views, original timeline 24fps. Boundaries overlap in the producer description and must be resolved by explicit scene/frame metadata, never guessed from a frame alone.
Read-only inspection of the documented TC3D_P1 and TC3D_A NAS Houdini results directories found them empty at this check. Thus all A–D slots remain not received. A future PC viewport capture is labelled PC Houdini viewport/procedural proxy, not renderer output and not physical simulation. Server matplotlib is a server proxy. Only actual PC output plus build/capture evidence and decode/hash checks permits PC provenance.
When actual results arrive: retain original HIP/output locations; verify file existence, hashes, decode, camera/frame/version/FPS and process provenance; register approved media IDs in the existing allowlist and publish non-sensitive scene metadata. Current NAS media root is the older TC00 delivery; the new TC3D directory is outside it. Do not silently widen that mount or place copies in NAS originals. A separate approved read-only media export/mount plan is required before serving these new assets. Existing four media items continue unchanged.

## Proposed operating change — execute only after final approval
1. Confirm source commit and review sign-off, record current image ID/digest, compose checksum and the prior media manifest checksum privately. Never export .env or credentials.
2. Build the candidate image locally on the host from the reviewed commit and already approved pinned base; no GitHub push/main merge is necessary. Never use latest or replace the 0.1.2 tag. Record candidate image ID.
3. Obtain final director/operator approval for replacing only the Houdini web image. Keep the existing compose service, UID/GID, host port 8097, portal card, /Houdini/ routing, env, NAS/collector/ledger read-only mounts and network unchanged. No Nginx edit/reload, cron edit, new port, DikeMap change or physical computation.
4. Change only IMAGE_TAG to the approved candidate tag using the existing operator procedure; recreate only service web with --no-deps. Brief interruption is possible; coordinate a window. This step was NOT performed.
5. Check the actual PaleoLab menu -> /Houdini/: light default / dark toggle, A–D missing state, overview/approval/reports/history; health/session; four existing media hash responses and video seeking; PC and mobile. Check existing DikeMap/portal routes remain responsive. Never treat the development URL as production delivery.
6. If any regression or data exposure is observed, immediately follow rollback below; do not repair live.

## Rollback — operator after approval
Retain the exact previous image 0.1.2 and its image ID. Restore only the previous IMAGE_TAG in the existing .env and recreate web only, without dependencies or image deletion. Verify /Houdini/ health, previous UI and four media endpoints. No data rollback is required because this candidate reads inputs and does not write production data. Preserve previous metadata and all originals. Do not run compose down, prune, reset shared branches or restore Nginx files: none were changed.

## Remaining approval items
- Independent re-review outcome for 93faea2 is unknown; excluded from this release candidate.
- Director's visual/final deployment approval for this UI-only candidate and operator execution window.
- Actual A–D media and provenance are pending. Do not request new simulation or render just to fill the screen.
- Any future TC3D media mount/export and release of its content require explicit scope approval.

No operating service, cron, NAS original, producer worktree or other researcher service was modified during preparation.

## Preparation results
- Isolated container, actual web UID/GID 1000:1000, network none and all inputs read-only: 41/41 regression tests PASS.
- Actual collector/ledger/NAS mounts: health, session, overview, reports, media, experiments APIs PASS. Report and media metadata identical to installed 0.1.2.
- Existing NAS media SHA256 4/4 and Range bytes 4/4 PASS. Authentication/media/collector/ledger modules, browser app.js and records unchanged from installed image.
- A–D manifest empty and unreviewed /api/jobs absent (404). New static assets follow existing auth checks.
- Test harness initially requested a nonexistent api/lab route; corrected to existing api/experiments. This was a test-path error, not an application change.
- Production Nginx/container/cron/portal/NAS untouched. No GitHub push or main merge.
