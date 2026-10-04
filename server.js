const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.get('/health', (q, r) => r.send('ok'));
app.use(express.static('public'));

// Approximate coordinates; adjust freely.
const TYPES = { wealthy: { pay: 1.5, npc: 3 }, middle: { pay: 1.2, npc: 4 }, ordinary: { pay: 1, npc: 5 }, commercial: { pay: 1.1, npc: 10 }, older: { pay: 0.9, npc: 6 } };
// type = neighborhood style (my first guess, edit freely). Coordinates are approximate.
const PLACES = [
  { id: 'mokola', name: 'Mokola', type: 'middle', lat: 7.4040, lng: 3.8990, job: 'Bus conductor', pay: 2500, xp: 6 },
  { id: 'dugbe', name: 'Dugbe Market', type: 'commercial', lat: 7.3890, lng: 3.8830, job: 'Market trader', pay: 3000, xp: 7 },
  { id: 'bodija', name: 'Bodija', type: 'wealthy', lat: 7.4300, lng: 3.9100, job: 'Provisions seller', pay: 3500, xp: 8 },
  { id: 'ui', name: 'University of Ibadan', type: 'middle', lat: 7.4443, lng: 3.9000, job: 'Campus tutor', pay: 4500, xp: 12 },
  { id: 'ringroad', name: 'Ring Road', type: 'commercial', lat: 7.3620, lng: 3.8760, job: 'Okada rider', pay: 3200, xp: 8 },
  { id: 'challenge', name: 'Challenge', type: 'commercial', lat: 7.3470, lng: 3.8780, job: 'Mechanic helper', pay: 3800, xp: 9 },
  { id: 'jericho', name: 'Jericho', type: 'wealthy', lat: 7.4150, lng: 3.8950, job: 'Restaurant waiter', pay: 3000, xp: 7 },
  { id: 'iwo', name: 'Iwo Road', type: 'commercial', lat: 7.3930, lng: 3.9420, job: 'Dispatch rider', pay: 3600, xp: 9 },
  { id: 'apata', name: 'Apata', type: 'ordinary', lat: 7.3500, lng: 3.8550, job: 'Brick layer', pay: 4000, xp: 10 },
  { id: 'akobo', name: 'Akobo', type: 'ordinary', lat: 7.4350, lng: 3.9650, job: 'Shop attendant', pay: 3300, xp: 8 },
  { id: 'sango', name: 'Sango', type: 'middle', lat: 7.4220, lng: 3.9200, job: 'Tailor assistant', pay: 3400, xp: 8 },
  { id: 'mapo', name: 'Mapo Hall', type: 'older', lat: 7.3880, lng: 3.8960, job: 'Tour guide', pay: 3700, xp: 9 },
  { id: 'okeado', name: 'Oke-Ado', type: 'older', lat: 7.3800, lng: 3.8900, job: 'Bakery helper', pay: 2800, xp: 6 },
  { id: 'oluyole', name: 'Oluyole', type: 'wealthy', lat: 7.3560, lng: 3.8800, job: 'Security guard', pay: 4200, xp: 10 },
  { id: 'agodi', name: 'Agodi', type: 'middle', lat: 7.4000, lng: 3.9080, job: 'Hospital porter', pay: 3600, xp: 9 },
  { id: 'bashorun', name: 'Bashorun', type: 'wealthy', lat: 7.4180, lng: 3.9380, job: 'Estate caretaker', pay: 3900, xp: 9 },
  { id: 'odoona', name: 'Odo-Ona', type: 'older', lat: 7.3640, lng: 3.8530, job: 'Welder helper', pay: 3100, xp: 8 },
  { id: 'newgarage', name: 'New Garage', type: 'commercial', lat: 7.3590, lng: 3.9130, job: 'Park loader', pay: 3300, xp: 8 },
  { id: 'eleyele', name: 'Eleyele', type: 'ordinary', lat: 7.4160, lng: 3.8550, job: 'Fish seller', pay: 2900, xp: 7 },
  { id: 'monatan', name: 'Monatan', type: 'ordinary', lat: 7.4080, lng: 3.8440, job: 'Delivery rider', pay: 3200, xp: 8 },
  { id: 'omiadio', name: 'Omi-Adio', type: 'ordinary', lat: 7.3760, lng: 3.8150, job: 'Farm hand', pay: 3000, xp: 8 },
];
const START = PLACES[0];
const players = {};
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180));
const nearest = p => PLACES.find(pl => meters(p, pl) < 200);
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
const hour = () => (Date.now() / 60000) % 24; // 1 real minute = 1 game hour
const ROLES = ['S', 'T', 'D', 'M', 'V', 'G']; // student, trader, driver, mechanic, vendor, guard
const npcs = [];
PLACES.forEach(h => { for (let k = 0; k < TYPES[h.type].npc; k++) {
  const w = Math.random() < 0.6 ? h : PLACES[Math.floor(Math.random() * PLACES.length)];
  npcs.push({ home: h, work: w, r: ROLES[Math.floor(Math.random() * ROLES.length)], lat: h.lat, lng: h.lng, off: [0, 0], shift: 6 + Math.random() * 2 });
} });
const ROUTES = [
  ['mokola', 'dugbe', 'okeado', 'mapo', 'ringroad', 'challenge', 'oluyole', 'apata', 'odoona'],
  ['ui', 'bodija', 'sango', 'bashorun', 'akobo', 'iwo', 'newgarage', 'agodi'],
  ['jericho', 'eleyele', 'monatan', 'omiadio', 'mokola', 'agodi', 'dugbe'],
  ['dugbe', 'ringroad', 'newgarage', 'iwo', 'bashorun', 'bodija', 'ui', 'jericho'],
];
const buses = ROUTES.map((r, i) => ({ id: i, route: r, stop: 0, wait: 0, lat: byId[r[0]].lat, lng: byId[r[0]].lng }));
function glide(o, t, step) {
  const d = meters(o, t);
  if (d <= step) { o.lat = t.lat; o.lng = t.lng; return true; }
  const f = step / d; o.lat += (t.lat - o.lat) * f; o.lng += (t.lng - o.lng) * f; return false;
}
setInterval(() => {
  const h = hour();
  for (const n of npcs) {
    const atWork = h >= n.shift && h < 17;
    const base = atWork ? n.work : n.home;
    if (Math.random() < 0.05) n.off = [(Math.random() - 0.5) * 0.002, (Math.random() - 0.5) * 0.002];
    const night = h >= 21 || h < 5;
    glide(n, { lat: base.lat + n.off[0] * (night ? 0.3 : 1), lng: base.lng + n.off[1] * (night ? 0.3 : 1) }, 40);
  }
  for (const b of buses) {
    if (b.wait > 0) { b.wait--; continue; }
    const st = byId[b.route[b.stop]];
    if (glide(b, st, 70)) { b.stop = (b.stop + 1) % b.route.length; b.wait = 6; }
  }
  const r5 = x => Math.round(x * 1e5) / 1e5;
  io.emit('world', { h, npcs: npcs.map(n => [r5(n.lat), r5(n.lng), n.r]), buses: buses.map(b => [b.id, r5(b.lat), r5(b.lng)]) });
}, 500);

io.on('connection', socket => {
  socket.on('join', d => {
    players[socket.id] = {
      id: socket.id, name: clean(d && d.name, 16) || 'Player', color: /^#[0-9a-f]{6}$/i.test(d && d.color) ? d.color : '#16a34a',
      lat: START.lat, lng: START.lng, target: null,
      money: 20000, energy: 100, xp: 0, level: 1, lastWork: 0, lastChat: 0, bus: null,
    };
    socket.emit('places', PLACES);
    sendMe(socket.id, 'Welcome to Ibadan! You start in Mokola with ₦20,000.');
  });
  socket.on('moveTo', t => {
    const p = players[socket.id];
    if (p && !p.bus && t && isFinite(t.lat) && isFinite(t.lng)) p.target = { lat: +t.lat, lng: +t.lng };
  });
  socket.on('work', () => {
    const p = players[socket.id]; if (!p) return;
    const pl = nearest(p);
    if (!pl) return sendMe(p.id, 'Walk to a location marker to work.');
    if (Date.now() - p.lastWork < 2500) return;
    if (p.energy < 10) return sendMe(p.id, 'Too tired. Eat something or wait.');
    p.lastWork = Date.now(); p.energy -= 10;
    const pay = Math.round(pl.pay * TYPES[pl.type].pay * (1 + (p.level - 1) * 0.08));
    p.money += pay; p.xp += pl.xp;
    while (p.xp >= p.level * 50) { p.xp -= p.level * 50; p.level++; }
    sendMe(p.id, `${pl.job} at ${pl.name}: +₦${pay.toLocaleString()}`);
  });
  socket.on('eat', () => {
    const p = players[socket.id]; if (!p) return;
    const pl = nearest(p);
    if (!pl) return sendMe(p.id, 'Walk to a location to buy food.');
    if (p.money < 1500) return sendMe(p.id, 'Not enough money.');
    p.money -= 1500; p.energy = Math.min(100, p.energy + 40);
    sendMe(p.id, `Ate amala at ${pl.name}: -₦1,500, +40 energy`);
  });
  socket.on('ride', () => {
    const p = players[socket.id]; if (!p) return;
    if (p.bus) { p.bus = null; return sendMe(p.id, 'You got off the danfo.'); }
    const b = buses.find(b => meters(p, b) < 250);
    if (!b) return sendMe(p.id, 'No danfo nearby. Wait at a marker.');
    if (p.money < 200) return sendMe(p.id, 'Fare is ₦200. Not enough money.');
    p.money -= 200; p.bus = b.id; p.target = null;
    sendMe(p.id, 'You boarded the danfo (-₦200). Tap Get off to leave.');
  });
  socket.on('chat', msg => {
    const p = players[socket.id]; if (!p) return;
    const text = clean(msg, 140);
    if (!text || Date.now() - p.lastChat < 800) return;
    p.lastChat = Date.now();
    io.emit('chat', { name: p.name, text });
  });
  socket.on('disconnect', () => { delete players[socket.id]; io.emit('left', socket.id); });
});

function sendMe(id, note) {
  const p = players[id]; if (!p) return;
  io.to(id).emit('me', { money: p.money, energy: Math.round(p.energy), level: p.level, xp: p.xp, need: p.level * 50, riding: !!p.bus, note });
}

setInterval(() => {
  const list = [];
  for (const p of Object.values(players)) {
    if (p.bus !== null && p.bus !== undefined) { const b = buses[p.bus]; p.lat = b.lat; p.lng = b.lng; }
    else if (p.target) {
      const d = meters(p, p.target), step = 8;
      if (d <= step) { p.lat = p.target.lat; p.lng = p.target.lng; p.target = null; }
      else { const f = step / d; p.lat += (p.target.lat - p.lat) * f; p.lng += (p.target.lng - p.lng) * f; }
    }
    list.push({ id: p.id, name: p.name, color: p.color, lat: p.lat, lng: p.lng, level: p.level });
  }
  io.emit('state', list);
}, 200);

setInterval(() => {
  for (const p of Object.values(players)) { p.energy = Math.min(100, p.energy + 1); sendMe(p.id); }
}, 5000);

srv.listen(process.env.PORT || 3000, () => console.log('Ibadan Life running'));
