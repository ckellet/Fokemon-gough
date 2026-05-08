import { computeCollectionStats, mergeRecentEvents } from "./app.logic.js";

const gun = window.Gun(["https://gun-manhattan.herokuapp.com/gun"]);
const eventsNode = gun.get("fokemon").get("events");

const cards = [
  { id: "voltlynx", name: "VoltLynx", type: "Electric" },
  { id: "mossaur", name: "Mossaur", type: "Leaf" },
  { id: "aquaphin", name: "AquaPhin", type: "Water" },
  { id: "emberoo", name: "Emberoo", type: "Fire" },
  { id: "cryptowl", name: "CryptOwl", type: "Shadow" },
];

const el = {
  auth: document.getElementById("authCard"), game: document.getElementById("gameCard"),
  form: document.getElementById("signupForm"), name: document.getElementById("trainerName"),
  team: document.getElementById("teamColor"), welcome: document.getElementById("welcome"),
  cardsList: document.getElementById("cardsList"), feedList: document.getElementById("feedList"),
  caughtCount: document.getElementById("caughtCount"), uniqueCount: document.getElementById("uniqueCount"),
  collection: document.getElementById("collection"), reset: document.getElementById("resetProfile"),
};

let profile = JSON.parse(localStorage.getItem("fokemon_profile") || "null");
let caught = JSON.parse(localStorage.getItem("fokemon_caught") || "[]");
let recentEvents = [];

const saveLocal = () => {
  localStorage.setItem("fokemon_profile", JSON.stringify(profile));
  localStorage.setItem("fokemon_caught", JSON.stringify(caught));
};

function renderCollection() {
  const stats = computeCollectionStats(caught);
  el.caughtCount.textContent = stats.total;
  el.uniqueCount.textContent = stats.unique;
  el.collection.innerHTML = stats.uniqueIds
    .map((id) => `<span class="chip">${cards.find((c) => c.id === id)?.name || id}</span>`)
    .join("");
}

const renderFeed = () => {
  const ordered = [...recentEvents].sort((a, b) => b.ts - a.ts).slice(0, 20);
  el.feedList.innerHTML = ordered.map((e) => `<li><strong>${e.trainer}</strong> caught ${e.card}</li>`).join("");
};

function catchCard(card) {
  const event = { trainer: profile.name, card: card.name, ts: Date.now() };
  caught.push({ id: card.id, ts: event.ts });
  saveLocal();
  renderCollection();
  eventsNode.set(event);
}

function renderCards() {
  el.cardsList.innerHTML = cards.map((card) => `<article class="poke-card"><strong>${card.name}</strong><div>${card.type}</div><button data-id="${card.id}">Catch</button></article>`).join("");
  el.cardsList.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => catchCard(cards.find((c) => c.id === btn.dataset.id))));
}

function connectFeed() {
  eventsNode.map().on((event) => {
    recentEvents = mergeRecentEvents(recentEvents, event, 100);
    renderFeed();
  });
}

function enterGame() {
  el.auth.classList.add("hidden");
  el.game.classList.remove("hidden");
  el.welcome.textContent = `Welcome, ${profile.name}`;
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
el.reset.addEventListener("click", () => { localStorage.removeItem("fokemon_profile"); location.reload(); });
if (profile?.name) enterGame();
