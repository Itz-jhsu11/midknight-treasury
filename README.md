# Midknight Treasury

Season budget + purchase-order tracker for **FTC Team 7854 — MidKnight Madness**.

- **Budget** — record money in (donations, sponsorships, grants) and money out (parts, events, travel); live team balance.
- **Purchase orders** — part, supplier, purchase link, cost each, quantity, auto total. Flow: Pending → Approved → Ordered → Received. Marking an order **received automatically deducts it from the balance** and moves it to Finished.
- **Accounts** — everyone gets their own PIN-protected account with a role: **Admin** (everything), **Treasurer** (money + approvals), **Member** (submit POs).

It's a single static page (`index.html`) backed by Firebase Firestore for shared, real-time team data. No build step.

## One-time setup (~5 minutes, free)

### 1. Create the Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project** (name it anything, e.g. `midknight-treasury`; Analytics not needed).
2. **Build → Firestore Database → Create database** — choose *production mode* and a nearby region (e.g. `us-west1`).
3. In Firestore's **Rules** tab, replace the contents with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**. (Visitors are signed in invisibly; nobody creates a Google account.)

### 2. Connect this app to it
1. In Firebase: **Project settings (gear icon) → Your apps → Web app (`</>`) → Register app** (no hosting needed).
2. Copy the `firebaseConfig = { ... }` object it shows you.
3. Paste it into [`firebase-config.js`](firebase-config.js), replacing `null`:
   ```js
   window.FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", /* etc. */ };
   ```
4. Commit and push — the site redeploys automatically.

### 3. Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → **Continue with GitHub**.
2. **Add New… → Project** → import **midknight-treasury** → framework preset **Other** → **Deploy**.
3. Your site is live at `https://<project>.vercel.app`. Every push to `main` redeploys.

## First run
The first person to open the site creates the Admin account, then adds everyone else (name + role + PIN) in the **Team** tab.

## Security notes
- PINs are stored as SHA-256 hashes; sessions are remembered per device.
- Firestore rules block anyone who isn't a site visitor, and roles are enforced in the app. This is team-trust-level protection — right for a team budget tracker, not for sensitive data.
- The Firebase config values in `firebase-config.js` are public identifiers, safe to commit.
