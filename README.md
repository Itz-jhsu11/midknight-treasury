# Midknight Treasury

Season budget + purchase-order tracker for **FTC Team 7854 — MidKnight Madness**.

- **Budget** — planned limits by category, actual spending, approved/ordered commitments, remaining budget, and over-budget warnings. Admins and treasurers set amounts; members can view.
- **Transactions** — record money in (donations, sponsorships, grants) and money out (parts, events, travel); live team balance.
- **Purchase orders** — the primary button opens the school Google Form with Madness preselected. Madness responses, prices, quantities, and spreadsheet statuses synchronize automatically. Blank and on-hold statuses start Pending. Admins and treasurers can also enter orders manually. Flow: Pending → Approved → Ordered → Received. Marking an order **received automatically deducts it from the balance** and moves it to Finished.
- **Accounts** — everyone gets their own PIN-protected account with a role: **Admin** (everything), **Treasurer** (money + approvals), **Member** (submit POs).

## How it works

The site is a single static page hosted on **GitHub Pages**. Team data lives in the **private** repo [`midknight-treasury-data`](https://github.com/Itz-jhsu11/midknight-treasury-data) as `data.json`, which the app reads and writes through the GitHub API. That repo's commit history is an automatic audit log of every budget change. No servers, no paid services, no extra accounts.

Teammates don't need GitHub accounts. Each device connects once with a **team access key**, then people sign in with their name + PIN as normal.

## Creating the team access key (admin, ~2 minutes)

The key is a GitHub fine-grained token that can touch **only** the data repo:

1. Go to <https://github.com/settings/personal-access-tokens/new> (signed in as the repo owner).
2. **Token name:** `treasury-team-key`. **Expiration:** custom — pick a date after the season ends.
3. **Repository access:** *Only select repositories* → choose **midknight-treasury-data**.
4. **Permissions → Repository permissions → Contents:** *Read and write*. (Metadata read-only gets added automatically.)
5. **Generate token** and copy it (starts with `github_pat_`).

Share the key privately with teammates (not in a public place). Each person pastes it into the site once; it's remembered on their device.

**If the key ever leaks or expires:** delete it at <https://github.com/settings/personal-access-tokens>, generate a new one the same way, and have everyone reconnect.

## Security notes

- The site code is public; the team's data is in a private repo only the access key can open.
- The key can *only* read/write that one data repo — it cannot touch anything else on the owner's GitHub.
- PINs are stored as SHA-256 hashes; roles are enforced by the app. This is team-trust-level protection — right for a team budget, not for sensitive personal data.
- Never commit the access key to this (public) repo.

## Development

`index.html` contains the UI and GitHub storage adapter. `budget.js` contains integer-cent cost/budget calculations and linked expense reconciliation; `form-sync.js` parses, validates, and reconciles Google Form responses. Edit and push to `main`; GitHub Pages redeploys automatically.

Run `npm ci` and `npm test` for the calculation, import, and simulated app tests. Tests use synthetic data and a mocked GitHub store; they never write live orders.


## Google Form connection

The existing response sheet is readable without signing in. Its sheet ID, tab ID,
activation time, and processed-response markers live in the **private data repo**
under `integrations.googleForm`; no response data or access keys are stored in this
public site repository. This integration does not change the sheet's sharing.

- When a teammate is signed in, the treasury checks the sheet on opening, on returning
  to the page, and every 60 seconds while the page is visible. Google export caching,
  network latency, or browser background throttling can delay a response.
- When the treasury is closed, Google Forms continues recording submissions. The next
  signed-in visit catches up. There is no background server or scheduled Actions job.
- Only `Team = Madness` is imported. Mayhem and Shared do not enter this treasury.
- With `integrations.googleForm.syncStatuses` enabled, Received/Delivered/Finished
  become Received, Ordered/Purchased become Ordered, Approved becomes Approved, and
  Denied/Rejected/Cancelled become Denied (case-insensitive). Blank and on-hold new
  requests remain Pending. Recognized spreadsheet status changes update the website;
  unchanged sheet statuses do not undo actions taken on the website between checks.
- Received orders automatically create one linked ledger expense. Corrected prices,
  quantities, or charges update that same expense rather than adding another. A later
  source status that conflicts with an existing expense is flagged for review and
  does not erase the expense. Expense dates record when the expense was logged; the
  sheet does not provide receipt/payment dates.
- **Total = price per item/pack × quantity + shipping + tax − discount.** Quantity is
  the number of items/packs requested; a pack size in a product name is not another
  multiplier. Charges and discounts are dollar amounts for that row, applied once.
- Optional sheet columns `Shipping` (or `Shipping Cost`), `Tax` (or `Sales Tax`), and
  `Discount` supply those charges. Blank values in present columns mean zero. Two
  columns for the same charge are rejected. No tax rate or shipping fee is guessed.
- When charge columns are absent, treasurers/admins use **Adjust costs** to enter
  those charges and select a budget category. Those amounts survive later imports.
  Fields supplied by the sheet are read-only in the cost dialog. Imported amounts
  show “Additional costs unconfirmed” until reviewed or shipping and tax columns
  are supplied. Adjusting a received order updates its existing ledger expense.
- Requester email appears in the private order list because the form collects email,
  not the treasury account ID. Imported orders are managed by treasurers/admins.
- IDs derive from the sheet, tab, submission timestamp, and requester email. Repeated
  checks, row sorting, and concurrent browser imports do not create duplicates.
  Deleting an imported order does not recreate it. Edits to existing response prices,
  quantities, and other source fields update the same order. Do not change source
  timestamps or emails; that would change response identity.
- Ambiguous duplicate identities and invalid new rows are flagged on the Orders tab;
  valid rows still import. Fix invalid entries in the source sheet and the next check
  retries them. Missing/unsafe purchase links are shown as unavailable without dropping
  the order or its cost. The initial 13 skipped Madness responses were backfilled on
  October 2, 2026 using explicit `backfillIds`; later deleted imports remain deleted.
- If sheet access changes or columns are renamed, Orders shows an import error and
  keeps the existing orders. Restoring source access resumes checks. A private-source
  integration would need a server-side authorized reader instead of this direct export.

## Category budget rules

The budget covers all transactions and orders in the current team data (the same
season scope as the dashboard). No amounts are invented on setup. Blank means no
budget is set; zero means a zero-dollar limit.

`Remaining = planned − actual expenses − approved/ordered commitments`.
Pending orders appear separately. Denied orders do not consume budget. When an order
is received, its expense and status are saved atomically in one GitHub update and it
moves from committed to actual spending. Spreadsheet receipt status uses this same
ledger reconciliation. Expense records with a matching purchase order ID are not also
counted as commitments. Unrecognized legacy expense categories
are shown under Other; orders without a category use Parts.
