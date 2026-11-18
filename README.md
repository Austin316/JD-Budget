# JD-Budget

## Cloud sync (optional)

Sign in with Google to keep the same budget on every device. Data is stored in Firebase (Firestore) under your account only.

1. Create a Firebase project, enable **Authentication → Google**, and create a **Firestore** database.
2. Paste `firestore.rules` into **Firestore → Rules** and publish.
3. Add `austin316.github.io` under **Authentication → Settings → Authorized domains**.
4. Put your web app config in `firebase-config.js`.

Without step 4 the app works as before, saved on the device only.
