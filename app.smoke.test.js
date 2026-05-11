import test from "node:test";
import assert from "node:assert/strict";

function makeStubEl() {
  const stub = {
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    querySelector() { return makeStubEl(); },
    querySelectorAll() { return []; },
    style: { setProperty() {}, left: "", top: "" },
    dataset: {},
    value: "",
    innerHTML: "",
    textContent: "",
  };
  return stub;
}

function installStubGlobals() {
  const stubStorage = (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  })();

  const doc = {
    getElementById() { return makeStubEl(); },
    documentElement: { style: { setProperty() {} } },
    body: { appendChild() {} },
    createElement() { return makeStubEl(); },
    addEventListener() {},
    removeEventListener() {},
  };

  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  define("document", doc);
  define("window", globalThis);
  define("localStorage", stubStorage);
  // Prevent the production setInterval from keeping the test process alive.
  define("setInterval", () => 0);
}

test("app.js evaluates without ReferenceErrors when DOM is stubbed", async () => {
  installStubGlobals();
  const cacheBust = `?t=${Date.now()}`;
  await assert.doesNotReject(() => import(`./app.js${cacheBust}`));
});
