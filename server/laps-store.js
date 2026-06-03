// In-memory store for lap data (NOT persisted in DB per design spec)
// Laps are attached to AI evaluation requests on-the-fly
const store = new Map();

function setLaps(sessionId, laps) {
  store.set(sessionId, laps);
}

function getLaps(sessionId) {
  return store.get(sessionId) || null;
}

function haslaps(sessionId) {
  return store.has(sessionId);
}

module.exports = { setLaps, getLaps, haslaps };
