// Cloud sync: Google sign-in + Firestore, layered on top of the on-device save.
// If Firebase isn't configured or can't load (offline, blocked network), the app keeps working on this device only.
import CONFIG from './firebase-config.js';

const V = '10.12.2';
const B = window.budget;
const btn = document.getElementById('sy');
const META = 'budget-sync-meta';

const getMeta = () => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch (e) { return {}; } };
const setMeta = (uid, json) => { try { localStorage.setItem(META, JSON.stringify({ uid, json })); } catch (e) {} };
const label = (t, title) => { btn.textContent = t; if (title) btn.title = title; };

function isEmpty(json) {
  try {
    const d = JSON.parse(json);
    return !d.notes && ['periods', 'monthly', 'balances', 'other', 'subs'].every(k => !(d[k] || []).length);
  } catch (e) { return true; }
}

if (!B || !btn) {
  // Main app didn't load; nothing to do.
} else if (!CONFIG) {
  btn.onclick = () => B.status('Sync is not set up yet. Your data is saved on this device.');
} else {
  start().catch(e => {
    console.warn('Sync unavailable', e);
    label('☁ Offline', 'Sync could not load. Your data is still saved on this device.');
    btn.onclick = () => B.status('Sync could not load here (offline or blocked). Your data is saved on this device.');
  });
}

async function start() {
  label('☁ …');
  const base = `https://www.gstatic.com/firebasejs/${V}/`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(CONFIG);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) {
    db = F.getFirestore(app);
  }

  let user = null, ref = null, unsub = null, ready = false;

  async function push(json) {
    if (!ref) return;
    try {
      await F.setDoc(ref, { json, updated: F.serverTimestamp() });
      setMeta(user.uid, json);
      if (json === B.get()) B.status('Saved · synced');
    } catch (e) {
      console.warn('Sync write failed', e);
      B.status('Saved on this device. Sync failed: ' + (e.code || 'error'));
    }
  }

  window.cloudSave = json => { if (ready) push(json); };

  function reconcile(remote) {
    const local = B.get();
    const meta = getMeta();
    const base = meta.uid === user.uid ? meta.json : undefined;
    if (remote == null) return push(local);                 // cloud empty: upload this device
    if (remote === local) { setMeta(user.uid, remote); return; }
    if (base !== undefined) {
      if (local === base) { B.apply(JSON.parse(remote), false); setMeta(user.uid, remote); return; } // only cloud changed
      if (remote === base) return push(local);                                                         // only this device changed
    } else if (isEmpty(local)) {
      B.apply(JSON.parse(remote), false); setMeta(user.uid, remote); return;                           // new device, nothing here yet
    }
    // Both sides have changes: ask.
    try { localStorage.setItem(B.KEY + '-before-sync', local); } catch (e) {}
    const useCloud = confirm('Your budget in the cloud is different from the one on this device.\n\nOK = use the cloud version on this device\nCancel = replace the cloud version with this device\'s version');
    if (useCloud) { B.apply(JSON.parse(remote), true); setMeta(user.uid, remote); B.status('Loaded the cloud version. Press Undo to go back.'); }
    else push(local);
  }

  function listen() {
    unsub = F.onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return; // only trust what the server confirms
      const remote = snap.exists() ? snap.data().json : null;
      if (!ready) {
        ready = true;
        reconcile(remote);
        label('☁ Synced', 'Signed in as ' + (user.email || 'you') + '. Tap to sign out.');
        return;
      }
      if (remote == null || remote === B.get()) { if (remote != null) setMeta(user.uid, remote); return; }
      if (B.busy()) return;                    // an edit here is about to save and will win
      B.apply(JSON.parse(remote), false);      // change made on another device
      setMeta(user.uid, remote);
      B.status('Updated from another device');
    }, e => {
      console.warn('Sync listen failed', e);
      label('☁ Error', 'Sync error: ' + (e.code || e.message));
      B.status('Sync error: ' + (e.code || 'unknown') + '. Your data is still saved on this device.');
    });
  }

  A.onAuthStateChanged(auth, u => {
    if (unsub) { unsub(); unsub = null; }
    ready = false; user = u; ref = null;
    if (!u) { label('☁ Sign in', 'Sign in with Google to sync across devices'); return; }
    label('☁ Syncing…', 'Signed in as ' + (u.email || 'you'));
    ref = F.doc(db, 'users', u.uid, 'budget', 'main');
    listen();
  });

  A.getRedirectResult(auth).catch(() => {});

  btn.onclick = async () => {
    if (user) {
      if (confirm('Sign out of sync on this device? Your data stays saved on this device.')) await A.signOut(auth);
      return;
    }
    const provider = new A.GoogleAuthProvider();
    try {
      await A.signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, provider);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        B.status('Sign-in failed: ' + (e.code || e.message));
      }
    }
  };
}
