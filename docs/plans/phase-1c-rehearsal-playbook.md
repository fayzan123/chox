# Phase 1c Founder Playbook — Rehearsal → Publish → Alpha

**Date:** 2026-07-14
**Audience:** Founder (user zero). Every step here is a founder action; nothing is
automated away.
**Position:** Phase 1c is implemented, committed on `phase-1c-taskable-first-run`
(through `cf5d365`), and verified green (typecheck, 185/185 tests, build,
`verify:pack`). The npm handle `chox` was re-verified unclaimed (404) on 2026-07-14.
Everything below is the path from here to the private alpha.

The order is strict: **rehearse → judge → merge → publish → demo → alpha.** Do not
skip ahead; the roadmap's exit gates (`docs/ROADMAP.md` §8–§9) assume this sequence.

> **Post-publish note (2026-07-14):** Steps 0–6 below are the historical 0.1.0
> procedure. `chox-cli@0.1.0` is now public and still installs the `chox` command.
> The audit in `result-0.1.0-publish-audit.md` found that publishing before the
> release commit made npm record the prior commit as `gitHead`. For every subsequent
> release, commit the exact release tree first, pass the publish gates from that clean
> commit, tag that commit, and publish from it; verify npm's `gitHead` against the tag
> before announcing the release.

---

## Step 0 — Pre-flight (5 minutes, in this repo)

Confirm the state you are rehearsing is the state you will publish.

```sh
cd ~/Documents/GitHub/chox
git status --short          # must be empty
git log --oneline -3        # cf5d365 should be at the top
npm run typecheck && npm test && npm run build
```

If anything is dirty or red, stop and fix before rehearsing — the rehearsal must
judge a reproducible commit.

**Known intentional quirk:** the repo-local `.chox/relays/spec-implement-review/`
relay in *this* repo is a pre-1c shadow with no `{{task}}` placeholder. Running the
task command inside the chox repo itself exits 2 with a migration message — by
design. **The rehearsal must happen in a different git repository**, where the
packaged built-in starter resolves instead.

---

## Step 1 — Build the artifact you will actually ship

```sh
cd ~/Documents/GitHub/chox
npm pack        # produces chox-0.0.0.tgz in the repo root
```

This tarball — not the source checkout — is the thing under judgment. Note its
path; you'll install from it in Step 3.

---

## Step 2 — Prepare the clean environment

The exit gate says "clean-machine." Three acceptable setups, best first:

1. **A second machine / fresh macOS user account** — truest to a stranger's
   experience. Copy only the `.tgz` over.
2. **Isolated npm prefix on this machine** — acceptable, and closest to what
   `verify:pack` already proved mechanically. The key requirements: the source
   checkout must not be on your `PATH`, and the global install must land in a
   throwaway prefix:

   ```sh
   export NPM_CONFIG_PREFIX="$HOME/chox-rehearsal-prefix"
   export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
   # sanity: `which chox` must find nothing yet
   ```

3. Do **not** rehearse via `npm link` or by running `dist/` from the checkout —
   that is exactly the path that hid the symlink-dispatch bug the packed verifier
   caught.

Unlike the automated verifier, the live rehearsal uses your **real** `~/.claude`,
`~/.codex`, and real agent binaries — that's the point: fake agents proved the
mechanics; you are judging the product.

Pick the target repo: any real git repository that is not chox (and ideally one
where a small real feature is genuinely wanted).

---

## Step 3 — Run the journey (the eight-criterion gate)

Each command below maps to an exit-gate criterion from
`docs/plans/phase-1c-build-packet.md` §6 / `docs/ROADMAP.md` §8. Run them in order.

### 3.1 Install without the source repo *(criterion 1)*

```sh
npm install -g /path/to/chox-0.0.0.tgz
which chox        # must resolve inside the clean prefix, not the checkout
```

### 3.2 Doctor guidance *(criterion 2)*

```sh
cd /path/to/your/target-repo
chox doctor
```

Expect: Node/sqlite checks, agent binary presence, source directory readability.
If doctor warns about anything real, follow its recovery text — recovering from a
doctor warning *is* part of the journey being judged.

### 3.3 Discover and inspect the starter *(criterion 3)*

```sh
chox relay list
chox relay show spec-implement-review
```

Expect: the built-in starter listed with `built-in` provenance, hop/runtime
sequence, gate posture, and "task required." `show` should read as a summary
first — full prompts only behind the explicit flag.

### 3.4 Supply a real task from a file *(criterion 4)*

Write `task.md` with a genuine small feature — real scope, real constraints, the
verification commands you'd want run. Not "add a hello world"; the gate says
*real task*.

### 3.5 Exact dry-run preview *(criterion 5)*

```sh
chox run spec-implement-review --task-file task.md --dry-run
```

Expect: hops in order, resolved runtimes/models/autonomy, the exact compiled
prompts **with your task text substituted**, artifact list, gate positions.
Read the compiled plan prompt fully — this is the "inspect what Chox will do"
moment a stranger gets.

### 3.6 The real run *(criterion 6)*

```sh
chox run spec-implement-review --task-file task.md
```

Expect: worktree created, then a **native interactive Claude session** opens with
the compiled prompt carrying your task. Work the hops as you normally would; the
agent's final message should tell you to exit the session to continue the relay.

### 3.7 Interrupt and resume *(criterion 7)*

At one gate (not before the first hop), press `Ctrl-C`. Then:

```sh
chox status                                    # pending gate should be visible
chox run spec-implement-review --resume
```

Expect: resume continues from the same gate on the **same compiled plan** — the
task text must be byte-identical (Chox must not re-read a changed `task.md`).
This was previously demonstrated only by tests; this run closes that caveat.

### 3.8 Zero relay-source edits *(criterion 8)*

At no point should you have opened or edited any file under the package's relay
directory or `~/.chox/relays/`. If you felt the need to, that's a gate failure —
record why.

### 3.9 Finish

Complete the remaining hops through review, approve at the gates, and note what
you do with the run branch (keep / merge / PR — this feeds the north-star metric
definition).

---

## Step 4 — Judge it (the part only you can do)

Two lenses:

**Mechanical:** all eight criteria above pass, plus: doctor bundle (if generated)
contains no task text; the process exits on its own at the end.

**Consumer** (from the 2026-07-14 product review): at every moment, could you
answer *what is happening, what did my keypress do, what happens next?* Write down
— verbatim, at the moment it happens — every point where you hesitated, re-read
output, or guessed. Those notes are P0/P1 candidates for the alpha; they are
cheapest to catch now, before five strangers hit them.

**Outcome:**
- **Pass** → Step 5.
- **Fail / friction that a stranger couldn't survive** → record it in
  `docs/plans/result-1c.md` under founder acceptance, file the fixes, re-run
  Step 3 after they land. Do not rationalize a marginal run into a pass — the
  alpha will re-expose it with five witnesses.

---

## Step 5 — Merge

```sh
cd ~/Documents/GitHub/chox
gh pr create --base main --head phase-1c-taskable-first-run \
  --title "Phase 1c: taskable first run" \
  --fill
# review, then merge via GitHub; confirm CI green on main afterwards
```

Record the acceptance (date + verdict + any caveats) in
`docs/plans/result-1c.md` under "Founder acceptance," and tick the Milestone 1
boxes in `docs/ROADMAP.md`.

---

## Step 6 — Claim the handle and publish

The handle decision is yours alone (standing rule: no placeholder publishes).
`chox` itself was unclaimed (404) as of 2026-07-14, but the real `npm publish`
attempt was rejected by the registry's anti-squatting similarity check (E403,
"too similar to existing packages" — chai/co/cron/etc.), not by the name being
taken. Founder decision (2026-07-14): avoid any personal-name scope
(`@fayzanmalik/chox`) and publish unscoped as **`chox-cli`** instead. The `bin`
field keeps the installed command `chox` regardless of the package name.

```sh
npm view chox-cli      # expect 404 immediately before publishing
```

Then, on `main`:

1. In `package.json`: remove `"private": true`, set the real version
   (`0.1.0` for the first public alpha), `name` is `chox-cli` (`bin.chox` is
   unchanged — the installed command stays `chox`).
2. Confirm the README leads with the installed quickstart and the privacy
   boundary (1c already restructured this — just re-read it as a stranger).
3. Publish:

   ```sh
   npm publish --dry-run   # inspect the file list one last time
   npm publish
   ```

4. Verify as a consumer, from a clean prefix:

   ```sh
   npm install -g chox-cli && chox doctor
   ```

5. Commit the version bump; tag it (`git tag v0.1.0 && git push --tags`).

   This ordering records what happened for 0.1.0. Do not reuse it for later
   releases; follow the post-publish note above so the published `gitHead`, release
   commit, and tag are the same commit.

---

## Step 7 — Record the demos

Two recordings, per the roadmap:

1. **Clean-install journey demo** (Milestone 1 deliverable): a short terminal
   recording of Step 3's happy path — install → doctor → relay show → task
   dry-run → first native session. Tools: `asciinema` or a plain screen capture.
2. **Cross-agent detection demo** (Phase 1b follow-through): `chox detect` on your
   real history → evidence → covered/installed relay → dry-run. This is the
   artifact no single-vendor tool can produce — it's the marketing centerpiece,
   and per the 2026-07-14 market review (Microsoft Conductor et al.), the
   detection story is the differentiator worth leading with, not model switching.

---

## Step 8 — Recruit the private alpha (Milestone 2)

Five developers matching the beachhead (`docs/ROADMAP.md` §2.1): macOS/Linux,
already running Claude Code **and** Codex on shared repos, terminal-comfortable.
At least three with meaningful dual history; up to two sparse (to test the
starter-only and no-findings paths honestly).

Follow the §9 study script per participant. The kill-switch is pre-committed:
**if fewer than two of five return within seven days, stop roadmap expansion and
diagnose retention** — no daemon, no new lenses, no app until that's understood.

---

## Parallel track (does not block any step above)

- **Two-week detection-quality window:** keep using `detect` normally; the §2.6
  metrics (≤1 dismissal/week, ≥50% precision) are measured from the findings
  table. Set the end date and note it in the roadmap.
- **Live overlapping-occurrence check:** if a real concurrent session pair shows
  up, confirm the evidence renders it as concurrency, not a false sequence; if
  none appears, record that fact — do not manufacture the claim.
- **CI matrix confirmation** on supported Node/OS versions after merge.

---

## Quick reference — the whole path

| # | Action | Where | Gate it satisfies |
|---|---|---|---|
| 0 | Pre-flight: clean tree, green suite | chox repo | reproducibility |
| 1 | `npm pack` | chox repo | the artifact under test |
| 2 | Clean prefix / machine, real agents | rehearsal env | "clean-machine" |
| 3 | Install → doctor → discover → task → dry-run → run → interrupt → resume | target repo | 1c exit criteria 1–8 |
| 4 | Judge mechanically + as a consumer | — | founder acceptance |
| 5 | PR + merge to main | GitHub | Milestone 1 close |
| 6 | Verify handle → un-private → `npm publish` → verify install | npm | first release |
| 7 | Record install demo + detection demo | — | Milestone 0/1 deliverables |
| 8 | Recruit 5 alpha users, run the §9 study | external | Milestone 2 |
