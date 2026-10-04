const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static('public'));

const PLACES = [
  { id: 'mokola', name: 'Mokola', lat: 7.4040, lng: 3.8990, job: 'Bus conductor', pay: 2500, xp: 6 },
  { id: 'dugbe', name: 'Dugbe Market', lat: 7.3890, lng: 3.8830, job: 'Market trader', pay: 3000, xp: 7 },
  { id: 'bodija', name: 'Bodija Market', lat: 7.4300, lng: 3.9100, job: 'Provisions seller', pay: 3500, xp: 8 },
  { id: 'ui', name: 'University of Ibadan', lat: 7.4443, lng: 3.9000, job: 'Campus tutor', pay: 4500, xp: 12 },
  { id: 'ringroad', name: 'Ring Road', lat: 7.3620, lng: 3.8760, job: 'Okada rider', pay: 3200, xp: 8 },
  { id: 'challenge', name: 'Challenge', lat: 7.3470, lng: 3.8780, job: 'Mechanic helper', pay: 3800, xp: 9 },
  { id: 'jericho', name: 'Jericho', lat: 7.4150, lng: 3.8950, job: 'Restaurant waiter', pay: 3000, xp: 7 },
  { id: 'iwo', name: 'Iwo Road', lat: 7.3930, lng: 3.9420, job: 'Dispatch rider', pay: 3600, xp: 9 },
  { id: 'apata', name: 'Apata', lat: 7.3500, lng: 3.8550, job: 'Brick layer', pay: 4000, xp: 10 },
  { id: 'akobo', name: 'Akobo', lat: 7.4350, lng: 3.9650, job: 'Shop attendant', pay: 3300, xp: 8 },
  { id: 'sango', name: 'Sango', lat: 7.4220, lng: 3.9200, job: 'Tailor assistant', pay: 3400, xp: 8 },
  { id: 'mapo', name: 'Mapo Hall', lat: 7.3880, lng: 3.8960, job: 'Tour guide', pay: 3700, xp: 9 },
  { id: 'okeado', name: 'Oke-Ado', lat: 7.3800, lng: 3.8900, job: 'Bakery helper', pay: 2800, xp: 6 },
  { id: 'oluyole', name: 'Oluyole', lat: 7.3560, lng: 3.8800, job: 'Security guard', pay: 4200, xp: 10 },
];
const START = PLACES[0];
const players = {};
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180));
const nearest = p => PLACES.find(pl => meters(p, pl) < 200);
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

io.on('connection', socket => {
  socket.on('join', d => {
    players[socket.id] = {
      id: socket.id, name: clean(d && d.name, 16) || 'Player', color: /^#[0-9a-f]{6}$/i.test(d && d.color) ? d.color : '#16a34a',
      lat: START.lat, lng: START.lng, target: null,
      money: 20000, energy: 100, xp: 0, level: 1, lastWork: 0, lastChat: 0,
    };
    socket.emit('places', PLACES);
    sendMe(socket.id, 'Welcome to Ibadan! You start in Mokola with ₦20,000.');
  });
  socket.on('moveTo', t => {
    const p = players[socket.id];
    if (p && t && isFinite(t.lat) && isFinite(t.lng)) p.target = { lat: +t.lat, lng: +t.lng };
  });
  socket.on('work', () => {
    const p = players[socket.id]; if (!p) return;
    const pl = nearest(p);
    if (!pl) return sendMe(p.id, 'Walk to a location marker to work.');
    if (Date.now() - p.lastWork < 2500) return;
    if (p.energy < 10) return sendMe(p.id, 'Too tired. Eat something or wait.');
    p.lastWork = Date.now(); p.energy -= 10;
    const pay = Math.round(pl.pay * (1 + (p.level - 1) * 0.08));
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
  io.to(id).emit('me', { money: p.money, energy: Math.round(p.energy), level: p.level, xp: p.xp, need: p.level * 50, note });
}

setInterval(() => {
  const list = [];
  for (const p of Object.values(players)) {
    if (p.target) {
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
