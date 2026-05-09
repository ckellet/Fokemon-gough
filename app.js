const FALLBACK_EVENTS_NODE = {
  set() {},
  map() {
    return { on() {} };
  },
};

let eventsNode = FALLBACK_EVENTS_NODE;

import("https://cdn.jsdelivr.net/npm/gun/gun.js")
  .then(({ default: Gun }) => {
    const gun = Gun(["https://gun-manhattan.herokuapp.com/gun"]);
    eventsNode = gun.get("fokemon").get("events");
    connectFeed();
  })
  .catch(() => {
    // Keep local gameplay working even when the public sync peer or CDN is unavailable.
    eventsNode = FALLBACK_EVENTS_NODE;
  });

const cards = [
  { id: "voltlynx", name: "VoltLynx", type: "Electric" },
  { id: "mossaur", name: "Mossaur", type: "Leaf" },
  { id: "aquaphin", name: "AquaPhin", type: "Water" },
  { id: "emberoo", name: "Emberoo", type: "Fire" },
  { id: "cryptowl", name: "CryptOwl", type: "Shadow" },
];

const el = {
  auth: document.getElementById("authCard"),
  game: document.getElementById("gameCard"),
  form: document.getElementById("signupForm"),
  name: document.getElementById("trainerName"),
  team: document.getElementById("teamColor"),
  welcome: document.getElementById("welcome"),
  cardsList: document.getElementById("cardsList"),
  feedList: document.getElementById("feedList"),
  caughtCount: document.getElementById("caughtCount"),
  uniqueCount: document.getElementById("uniqueCount"),
  collection: document.getElementById("collection"),
  reset: document.getElementById("resetProfile"),
};

let profile = JSON.parse(localStorage.getItem("fokemon_profile") || "null");
let caught = JSON.parse(localStorage.getItem("fokemon_caught") || "[]");
const recentEvents = [];
const caughtIds = new Set(caught.map((c) => c.id));
let feedConnected = false;
let activeChallenge = null;

function saveLocal() {
  localStorage.setItem("fokemon_profile", JSON.stringify(profile));
  localStorage.setItem("fokemon_caught", JSON.stringify(caught));
}

function renderCollection() {
  el.caughtCount.textContent = caught.length;
  const unique = [...new Set(caught.map((c) => c.id))];
  el.uniqueCount.textContent = unique.length;
  el.collection.innerHTML = unique
    .map((id) => `<span class="chip">${cards.find((c) => c.id === id)?.name || id}</span>`)
    .join("");
}

function renderFeed() {
  const ordered = [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, 20);
  el.feedList.innerHTML = ordered.map((e) => `<li><strong>${e.trainer}</strong> caught ${e.card}</li>`).join("");
}

function catchCard(card) {
  const event = {
    trainer: profile.name,
    card: card.name,
    ts: Date.now(),
  };

  caught.push({ id: card.id, ts: event.ts });
  caughtIds.add(card.id);
  saveLocal();
  renderCollection();
  renderCards();
  eventsNode.set(event);
}

function launchCatchChallenge(card) {
  if (activeChallenge) return;

  const challenge = document.createElement("div");
  challenge.className = "catch-challenge";
  challenge.innerHTML = `
    <div class="challenge-card">
      <p class="eyebrow">Catch challenge</p>
      <h3>Snare ${card.name}</h3>
      <p>Hold your focus and click the glowing core while it moves.</p>
      <div class="arena">
        <button class="target" aria-label="Catch target"></button>
      </div>
      <p class="status">Hits: <strong>0/3</strong> • Time left: <strong>6.0s</strong></p>
      <button class="ghost cancel">Run away</button>
    </div>
  `;
  document.body.appendChild(challenge);
  activeChallenge = challenge;

  const target = challenge.querySelector(".target");
  const status = challenge.querySelector(".status");
  const cancel = challenge.querySelector(".cancel");

  let hits = 0;
  const totalHits = 3;
  const duration = 6000;
  const started = performance.now();

  function moveTarget() {
    const x = Math.random() * 75 + 5;
    const y = Math.random() * 70 + 8;
    target.style.left = `${x}%`;
    target.style.top = `${y}%`;
  }

  function closeChallenge() {
    challenge.remove();
    activeChallenge = null;
  }

  function updateStatus(timeLeftMs) {
    status.innerHTML = `Hits: <strong>${hits}/${totalHits}</strong> • Time left: <strong>${(timeLeftMs / 1000).toFixed(1)}s</strong>`;
  }

  function tick() {
    const elapsed = performance.now() - started;
    const left = Math.max(0, duration - elapsed);
    updateStatus(left);
    if (left <= 0) {
      status.innerHTML = `<span class="fail">escaped!</span> ${card.name} slipped away.`;
      setTimeout(closeChallenge, 900);
      return;
    }
    requestAnimationFrame(tick);
  }

  const mover = setInterval(moveTarget, 500);
  moveTarget();
  tick();

  target.addEventListener("click", () => {
    hits += 1;
    target.classList.add("hit");
    setTimeout(() => target.classList.remove("hit"), 140);
    if (hits >= totalHits) {
      clearInterval(mover);
      status.innerHTML = `<span class="success">Captured!</span> ${card.name} joined your collection.`;
      catchCard(card);
      setTimeout(closeChallenge, 800);
      return;
    }
    moveTarget();
  });

  cancel.addEventListener("click", () => {
    clearInterval(mover);
    closeChallenge();
  });
}

function renderCards() {
  const availableCards = cards.filter((card) => !caughtIds.has(card.id));

  if (!availableCards.length) {
    el.cardsList.innerHTML = `<p class="empty-state">You caught every nearby Fokemon. Check back later for new spawns.</p>`;
    return;
  }

  el.cardsList.innerHTML = availableCards
    .map(
      (card) => `
    <article class="poke-card">
      <strong>${card.name}</strong>
      <div>${card.type}</div>
      <button data-id="${card.id}">Start catch challenge</button>
    </article>
  `
    )
    .join("");

  el.cardsList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = cards.find((c) => c.id === btn.dataset.id);
      launchCatchChallenge(card);
    });
  });
}

function connectFeed() {
  if (feedConnected) return;
  feedConnected = true;

  eventsNode.map().on((event) => {
    if (!event || !event.ts || !event.trainer || !event.card) return;
    const alreadyThere = recentEvents.some((e) => e.ts === event.ts && e.trainer === event.trainer && e.card === event.card);
    if (alreadyThere) return;
    recentEvents.push(event);
    if (recentEvents.length > 100) recentEvents.shift();
    renderFeed();
  });
}

function enterGame() {
  el.auth.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.welcome.textContent = `Welcome, ${profile.name}`;
  document.documentElement.style.setProperty(
    "--accent",
    profile.team === "violet" ? "#ca90ff" : profile.team === "sun" ? "#ffd173" : "#7cf0c6"
  );
  renderCards();
  renderCollection();
  connectFeed();
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  profile = { name: el.name.value.trim(), team: el.team.value };
  if (!profile.name) return;
  saveLocal();
  enterGame();
});

el.reset.addEventListener("click", () => {
  localStorage.removeItem("fokemon_profile");
  location.reload();
});

if (profile?.name) enterGame();
