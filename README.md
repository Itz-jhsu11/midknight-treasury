# Midknight Treasury

Season budget + purchase-order tracker for **FTC Team 7854 — MidKnight Madness**.

- **Budget** — record money in (donations, sponsorships, grants) and money out (parts, events, travel); live team balance.
- **Purchase orders** — part, supplier, purchase link, cost each, quantity, auto total. Flow: Pending → Approved → Ordered → Received. Marking an order **received automatically deducts it from the balance** and moves it to Finished.
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

`index.html` is the whole app — edit and push to `main`, GitHub Pages redeploys automatically.
