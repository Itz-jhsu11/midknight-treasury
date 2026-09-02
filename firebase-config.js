// ============================================================
// Midknight Treasury — Firebase connection
// ============================================================
// The app needs a (free) Firebase project for its shared team
// database. Full steps are in README.md. Short version:
//
//   1. https://console.firebase.google.com → Add project
//   2. Build → Firestore Database → Create database
//   3. Build → Authentication → Sign-in method → enable "Anonymous"
//   4. Project settings (gear) → Your apps → Web (</>) → Register app
//   5. Copy the firebaseConfig object it shows you and paste it
//      below, replacing `null`, so it reads:
//      window.FIREBASE_CONFIG = { apiKey: "...", ... };
//   6. Commit + push — Vercel redeploys automatically.
//
// (These config values are safe to commit — they identify the
// project publicly; access is controlled by Firestore rules.)
// ============================================================

window.FIREBASE_CONFIG = null;
