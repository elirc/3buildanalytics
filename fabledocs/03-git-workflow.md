# 03 — The git and PR workflow used in this repo

This repo's history is meant to be *read*. Every branch, commit, and PR is
written so that someone learning the codebase can follow not just what changed
but why. This document explains the conventions so you can match them.

Worked example: **PR #1 (US-20)**. Read it alongside this page.

---

## 1. One story, one branch, one PR

```
main
 └── us-20-test-harness-and-ci      <- branch name = story id + short slug
```

Branch naming: `us-<NN>-<kebab-slug>`. The story id makes the branch
self-describing in `git branch -a` six months later.

Never commit directly to `main`. Even a one-line fix goes through a PR, because
the PR is where the reasoning lives.

## 2. Commits are chapters, not checkpoints

A commit is not "here is where I stopped for lunch". It is one coherent idea
that a reviewer can evaluate on its own. PR #1 shipped seven:

```
test: add database-backed test harness
test: add RBAC contract test covering every route and role
test: add integration coverage for auth, events, and dashboard
fix(cache): fail fast when Redis is unreachable instead of hanging
test: add frontend provider helpers and route-guard tests
ci:  run tests against real Postgres and Redis
ci:  point e2e origins at 127.0.0.1 so CORS permits the login request
```

Notice what that ordering buys a reviewer: infrastructure first, then the tests
that use it, then the one production change, then CI. Each commit is
independently understandable. The reviewer who only cares about the production
change goes straight to `fix(cache)`.

**Format:** `<type>(<optional scope>): <imperative summary under ~72 chars>`

Types used here: `feat`, `fix`, `test`, `ci`, `docs`, `refactor`, `chore`.

**The body is the point.** The summary says what; the body says why. A good
body answers:

- What was the behaviour before, and why was it wrong?
- Why this fix and not an obvious alternative?
- What did you deliberately *not* do?

Compare:

```
fix: redis config                        <- tells a future reader nothing
```

against the real one, which explains that `maxRetriesPerRequest: null` made
ioredis queue commands forever, that the surrounding try/catch therefore never
ran, that this contradicted the "Redis is optional" behaviour `server.ts`
already advertised, and that BullMQ was left alone because blocking commands
genuinely need the old setting.

The second one is what stops the next person re-introducing the bug.

**Practical note for this machine:** there is no global git identity, so set it
per repo (`git config user.name` / `user.email`). Write commit messages to a
file and use `git commit -F <file>` — multi-line messages via `-m` get mangled
by the shell.

## 3. Pull requests

The PR body is for the reviewer, not for the changelog. The template this repo
follows:

| Section | Purpose |
| --- | --- |
| **Why this one first** / **Why** | The motivation a ticket number does not carry |
| **What changed** | Grouped by area, a few lines each — not a file list, git already has that |
| **Bugs found / fixed** | Anything discovered along the way, named plainly |
| **How to review** | Where to start, and what to try in order to convince yourself |
| **Verification** | Exact commands and results, including what you did *not* verify |
| **Out of scope** | Explicitly deferred work, so its absence reads as a decision |

Two habits worth copying from PR #1:

**Say what you did not verify.** That PR stated plainly that the Playwright
spec had never been run locally because browsers were not installed, and that
CI was the only place it executed. A reviewer who knows the gap can weigh it. A
reviewer who is told "all tests pass" cannot.

**Leave found bugs visible.** Writing the auth tests surfaced two real defects
(refresh tokens colliding within a second; a malformed token returning 500).
Neither was in scope, so neither was silently patched or quietly deleted. They
were committed as `it.skip` with an explanation and assigned to US-04 — and the
500 was additionally pinned by a *passing* test, so fixing it breaks that
assertion and forces whoever does US-04 to un-skip its counterpart.

That last trick is worth internalising: **encode the follow-up in the test
suite, not in a TODO comment.** TODOs rot silently; a failing assertion does not.

## 4. Merge on green, and merge, don't squash

CI must be green before merge. When e2e failed on PR #1, the fix was a commit
on the same branch, not a merge with a red check and a promise to fix later.

This repo merges with `--merge`, not `--squash`. Squashing would collapse those
seven chapters into one blob and destroy exactly the thing this history exists
to teach. Squash is a reasonable default on teams that treat commits as
checkpoints; here they are the deliverable.

```bash
gh pr merge <n> --merge --delete-branch
```

## 5. Reading the history later

```bash
git log --oneline --graph            # shape of the work, one line per chapter
git log --format=%B -n 1 <sha>       # the reasoning behind one change
git log -p -- backend/src/cache/     # how one area evolved, with diffs
gh pr view 1                         # the review-level story
```

If you are about to change something and cannot tell why it is the way it is,
`git log -p` on that file is usually faster than asking.

---

## Backlog status

Story-by-story progress against [`02-user-stories.md`](02-user-stories.md).

| Story | Status | PR |
| --- | --- | --- |
| US-20 Database-backed tests and CI | **Merged** | [#1](https://github.com/elirc/3buildanalytics/pull/1) |
| US-01 Navigation matches real permissions | **Merged** | [#3](https://github.com/elirc/3buildanalytics/pull/3) |
| US-02 … US-19 | Not started | — |

US-20 was pulled ahead of US-01 for the reason given in its PR: every other
story asks for integration tests, and until CI ran a database none of them
could have been written.

Two defects were found and deferred to US-04, and one (the Redis hang) was
fixed in US-20 because the test suite could not run without it.
