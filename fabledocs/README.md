# fabledocs

Onboarding pack for the **Analytics + Admin Dashboard Platform**, written for a junior
engineer who is about to make their first changes to this repo.

| File | What it is | Read when |
| --- | --- | --- |
| [`01-app-overview.md`](01-app-overview.md) | What the product does, how the code is organised, how a request flows end to end, and the honest list of gaps | Before you touch anything |
| [`02-user-stories.md`](02-user-stories.md) | 20 implementation-ready user stories (US-01 … US-20) with acceptance criteria, file lists, and test requirements | When you pick up your first ticket |

## How to use this pack

1. Read `01-app-overview.md` top to bottom once. Don't skim the
   "Conventions you must copy" and "Known gaps" sections — most review comments on
   this codebase come from missing one of those.
2. Get the app running locally (`01-app-overview.md` § *Running it*).
   Log in as `system_admin@example.com` / `Password123!` and click every page in the
   sidebar as at least three different seeded roles. You will see broken things.
   That is expected — several of them are the stories in `02-user-stories.md`.
3. Pick a story from the **Tier 1** table in `02-user-stories.md`. Do them in order
   the first time; they are sequenced so each one teaches something the next one uses.
4. Open one PR per story. The story's *Definition of done* is the PR checklist.

## Relationship to `docs/`

`docs/` already contains a large learning curriculum (`docs/upskill/`) plus tours and
guides. This pack does not replace it:

- `docs/` explains **how to learn from** the codebase (drills, katas, rubrics).
- `fabledocs/` explains **what the codebase is** and **what to build next**.

Where the two overlap, `docs/upskill/08-reference/risk-register.md` is the existing
list of known risks; `01-app-overview.md` § *Known gaps* extends it with things found
during the 2026-07-24 review and maps each one to the story that fixes it.
