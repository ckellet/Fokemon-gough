// Player identity for FokéGo.
//
// Identity is a GUN/SEA key pair; its `pub` key is the authoritative, unspoofable
// player id (the freeform trainer name is just a display label). This module
// produces and persists that pair and, on the native app, gates it behind
// Sign in with Apple.
//
//   • Native (Capacitor):  Sign in with Apple → SEA pair stored in the iOS
//     Keychain (capacitor-secure-storage-plugin). Apple is the bar to entry;
//     the Keychain pair is the identity. Restores silently on relaunch.
//   • Web (no Capacitor):  an anonymous SEA pair persisted in localStorage, so
//     the data model is identical to native. (Web stays un-gated by design.)
//
// Loaded as a classic script (exposes window.FokeIdentity) BEFORE app.js, which
// reads the pair and calls gun.user().auth(pair). SEA / the Capacitor plugins
// are only touched inside the async methods below — never at load time — because
// the deferred vendor scripts (gun/sea) haven't run yet when this file is parsed.

(function () {
  const PAIR_KEY = "fokemon_sea_pair";
  const APPLE_KEY = "fokemon_apple_user";

  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  const isNative = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());

  // Reflect platform in the DOM so CSS can show the right auth affordance
  // (Sign in with Apple on native, the name form on web).
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.add(isNative ? "is-native" : "is-web");
  }

  function sea() {
    const SEA = window.Gun && window.Gun.SEA;
    if (!SEA) throw new Error("[identity] Gun.SEA unavailable");
    return SEA;
  }

  function plugin(name) {
    return (cap && cap.Plugins && cap.Plugins[name]) || null;
  }

  function isValidPair(p) {
    return p && typeof p.pub === "string" && typeof p.priv === "string" && p.epub && p.epriv;
  }

  // ---- secure persistence (Keychain on native, localStorage on web) --------

  async function storeGet(key) {
    if (isNative) {
      const ss = plugin("SecureStoragePlugin");
      if (!ss) return null;
      try {
        const res = await ss.get({ key });
        return res && typeof res.value === "string" ? res.value : null;
      } catch {
        return null; // plugin throws when the key is absent
      }
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async function storeSet(key, value) {
    if (isNative) {
      const ss = plugin("SecureStoragePlugin");
      if (ss) {
        try { await ss.set({ key, value }); return; } catch {}
      }
    }
    try { window.localStorage.setItem(key, value); } catch {}
  }

  async function storeRemove(key) {
    if (isNative) {
      const ss = plugin("SecureStoragePlugin");
      if (ss) {
        try { await ss.remove({ key }); } catch {}
      }
      return;
    }
    try { window.localStorage.removeItem(key); } catch {}
  }

  // ---- pair lifecycle ------------------------------------------------------

  async function loadStoredPair() {
    const raw = await storeGet(PAIR_KEY);
    if (!raw) return null;
    try {
      const pair = JSON.parse(raw);
      return isValidPair(pair) ? pair : null;
    } catch {
      return null;
    }
  }

  async function createAndStorePair() {
    const pair = await sea().pair();
    if (!isValidPair(pair)) throw new Error("[identity] SEA.pair() returned an invalid pair");
    await storeSet(PAIR_KEY, JSON.stringify(pair));
    return pair;
  }

  let current = null; // { pub, pair, appleUser }

  function expose(pair, appleUser) {
    current = { pub: pair.pub, pair, appleUser: appleUser || null };
    return current;
  }

  // ---- public API ----------------------------------------------------------

  // Silent restore on boot. Web: load-or-create a local pair (always returns an
  // identity). Native: return the stored pair if the player has signed in before
  // (returning user), else null — the caller must then prompt Sign in with Apple.
  async function restore() {
    const stored = await loadStoredPair();
    if (stored) {
      const appleUser = await storeGet(APPLE_KEY);
      return expose(stored, appleUser);
    }
    if (isNative) return null; // first run on this device → require Apple sign-in
    return expose(await createAndStorePair(), null);
  }

  // Native entry: run the Sign in with Apple flow, then load-or-create the pair.
  // Uses @capgo/capacitor-social-login (Capacitor 8 compatible). Its plugin is
  // registered as `SocialLogin`; Apple sign-in goes through initialize() + login().
  let socialInited = false;
  async function signInWithApple() {
    const sl = plugin("SocialLogin");
    if (!sl) throw new Error("[identity] Sign in with Apple is unavailable on this platform");
    if (!socialInited) {
      // On iOS the native Sign in with Apple capability supplies the client id,
      // so an empty apple config is enough.
      await sl.initialize({ apple: {} });
      socialInited = true;
    }
    const res = await sl.login({ provider: "apple", options: { scopes: [] } }); // identity only
    const appleUser = res && res.result && res.result.profile && res.result.profile.user;
    if (!appleUser) throw new Error("[identity] Sign in with Apple returned no user id");
    await storeSet(APPLE_KEY, appleUser);
    const pair = (await loadStoredPair()) || (await createAndStorePair());
    return expose(pair, appleUser);
  }

  // Sign out. `forget` also drops the device-local identity (Keychain pair +
  // Apple linkage), so the next sign-in mints a brand-new pub. (GUN user deauth
  // is the caller's job — app.js owns the gun instance and calls user().leave().)
  async function signOut({ forget = false } = {}) {
    if (forget) {
      await storeRemove(PAIR_KEY);
      await storeRemove(APPLE_KEY);
      current = null;
    }
  }

  window.FokeIdentity = {
    isNative,
    restore,
    signInWithApple,
    signOut,
    get current() { return current; },
    get pub() { return current && current.pub; },
    get pair() { return current && current.pair; },
  };
})();
