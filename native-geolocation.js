// Native geolocation bridge for the Capacitor (iOS/Android) build.
//
// WKWebView (and Android's WebView) do NOT expose a working
// `navigator.geolocation` to page JS — the native layer owns CoreLocation.
// Capacitor's @capacitor/geolocation plugin does, so this shim transparently
// remaps the standard `navigator.geolocation` + `navigator.permissions.query`
// surface that app.js already uses onto the plugin.
//
// Design goals:
//   * app.js is UNCHANGED — it keeps calling navigator.geolocation.* as on web.
//   * Completely inert on the web build: if there's no native Capacitor
//     runtime, we return immediately and the real browser APIs are used.
//   * This file is included (before app.js) ONLY in the native index.html
//     produced by scripts/build-mobile.mjs. The web index.html never loads it.
//
// Loaded as a classic script (no imports) so it can run before the ES-module
// app.js and rely purely on the globals Capacitor injects.

(function () {
  const Cap = typeof window !== "undefined" ? window.Capacitor : null;
  if (!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform()) {
    return; // Web build — leave the real browser geolocation in place.
  }

  const Geo = Cap.Plugins && Cap.Plugins.Geolocation;
  if (!Geo) {
    // Plugin missing from the build — better to surface this than silently fail.
    console.warn("[native-geo] @capacitor/geolocation not found; navigator.geolocation left as-is");
    return;
  }

  // --- helpers -------------------------------------------------------------

  // Map the plugin's permission shape ({ location, coarseLocation }) to the
  // Permissions API states the app expects ("granted" | "denied" | "prompt").
  function stateOf(status) {
    const loc = status && (status.location || status.coarseLocation);
    if (loc === "granted") return "granted";
    if (loc === "denied") return "denied";
    return "prompt";
  }

  // Ensure we hold the permission before starting CoreLocation. On iOS the
  // plugin's watchPosition will NOT prompt on its own, so we drive the prompt.
  async function ensurePermission() {
    let status = null;
    try { status = await Geo.checkPermissions(); } catch {}
    if (stateOf(status) === "granted") return true;
    try { status = await Geo.requestPermissions(); } catch {}
    return stateOf(status) === "granted";
  }

  // Shape a plugin/JS error into a GeolocationPositionError-like object so the
  // app's onPositionError handler (which may read .code/.message) is happy.
  function toError(e) {
    const msg = (e && e.message) || String(e || "Location error");
    const denied = /denied|permission|authoriz/i.test(msg);
    return {
      code: denied ? 1 : 2, // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE
      message: msg,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
  }

  // --- navigator.permissions.query (geolocation only) ----------------------

  const realPermissions = navigator.permissions || null;
  const realQuery = realPermissions && realPermissions.query
    ? realPermissions.query.bind(realPermissions)
    : null;

  async function query(desc) {
    if (desc && desc.name === "geolocation") {
      let status = null;
      try { status = await Geo.checkPermissions(); } catch {}
      const state = stateOf(status);
      // Minimal PermissionStatus-like object. The plugin gives us no live
      // change stream, so addEventListener is a documented no-op — app.js
      // already guards it with `typeof status.addEventListener === "function"`.
      return {
        state,
        status: state,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
      };
    }
    if (realQuery) return realQuery(desc);
    throw new Error("permissions.query unsupported for: " + (desc && desc.name));
  }

  const permsShim = { query };
  try {
    Object.defineProperty(navigator, "permissions", { value: permsShim, configurable: true });
  } catch {
    if (realPermissions) {
      try { realPermissions.query = query; } catch {}
    }
  }

  // --- navigator.geolocation ----------------------------------------------

  let nextId = 1;
  const watches = new Map(); // numericId -> { capId: string|null, cleared: bool }

  const geolocation = {
    getCurrentPosition(success, error, options) {
      (async () => {
        if (!(await ensurePermission())) {
          if (error) error(toError({ message: "Location permission denied" }));
          return;
        }
        try {
          const pos = await Geo.getCurrentPosition(options || {});
          if (success) success(pos);
        } catch (e) {
          if (error) error(toError(e));
        }
      })();
    },

    watchPosition(success, error, options) {
      // Return a synchronous numeric id immediately (the app stores it as
      // `watchId`); wire up the real native watch asynchronously.
      const id = nextId++;
      const rec = { capId: null, cleared: false };
      watches.set(id, rec);

      (async () => {
        if (!(await ensurePermission())) {
          if (error) error(toError({ message: "Location permission denied" }));
          return;
        }
        if (rec.cleared) return; // cleared before the prompt resolved
        try {
          const capId = await Geo.watchPosition(options || {}, (pos, err) => {
            if (rec.cleared) return;
            if (err) { if (error) error(toError(err)); return; }
            if (pos && success) success(pos);
          });
          if (rec.cleared) {
            try { Geo.clearWatch({ id: capId }); } catch {}
          } else {
            rec.capId = capId;
          }
        } catch (e) {
          if (error) error(toError(e));
        }
      })();

      return id;
    },

    clearWatch(id) {
      const rec = watches.get(id);
      if (!rec) return;
      rec.cleared = true;
      watches.delete(id);
      if (rec.capId) {
        try { Geo.clearWatch({ id: rec.capId }); } catch {}
      }
    },
  };

  try {
    Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
  } catch {
    try { navigator.geolocation = geolocation; } catch {}
  }

  console.info("[native-geo] navigator.geolocation bridged to Capacitor Geolocation");
})();
