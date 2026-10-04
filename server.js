const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);

app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_RAILWAY';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

/* =========================================================
   DATABASE
========================================================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(16) UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name VARCHAR(16) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#16a34a',

      money BIGINT NOT NULL DEFAULT 20000,
      energy INTEGER NOT NULL DEFAULT 100,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,

      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      token_id TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      receiver_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(requester_id, receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      receiver_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_transactions (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      receiver_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      amount BIGINT NOT NULL,
      type VARCHAR(30) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_requests (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      requested_from_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      note TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_key VARCHAR(100) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(player_id, item_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      property_key VARCHAR(100) UNIQUE NOT NULL,
      property_type VARCHAR(30) NOT NULL,
      name VARCHAR(150) NOT NULL,
      price BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
      vehicle_key VARCHAR(100) UNIQUE NOT NULL,
      vehicle_type VARCHAR(30) NOT NULL,
      name VARCHAR(150) NOT NULL,
      price BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('Database ready.');
}

/* =========================================================
   AUTH HELPERS
========================================================= */

function clean(s, n) {
  return String(s || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, n);
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,16}$/.test(username);
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 100;
}

function validColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color);
}

function createToken(player) {
  return jwt.sign(
    {
      sub: String(player.id),
      username: player.username,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function getPlayerById(id) {
  const result = await pool.query(
    `SELECT id, username, password_hash, google_id, name, color,
            money, energy, xp, level, lat, lng
     FROM players
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function authFromToken(token) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const player = await getPlayerById(decoded.sub);
    return player;
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  authFromToken(header.slice(7))
    .then(player => {
      if (!player) return res.status(401).json({ error: 'Invalid or expired login.' });
      req.player = player;
      next();
    })
    .catch(() => res.status(500).json({ error: 'Authentication error.' }));
}

/* =========================================================
   AUTH API
========================================================= */

app.post('/api/auth/signup', async (req, res) => {
  try {
    const username = clean(req.body?.username, 16);
    const password = req.body?.password;
    const confirmPassword = req.body?.confirmPassword;
    const color = validColor(req.body?.color) ? req.body.color : '#16a34a';

    if (!validUsername(username)) {
      return res.status(400).json({
        error: 'Username must be 3-16 characters using letters, numbers, or _.'
      });
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match.'
      });
    }

    const existing = await pool.query(
      `SELECT id FROM players WHERE LOWER(username) = LOWER($1)`,
      [username]
    );

    if (existing.rowCount) {
      return res.status(409).json({
        error: 'That username is already taken.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO players
       (username, password_hash, name, color, money, energy, xp, level, lat, lng)
       VALUES ($1, $2, $3, $4, 20000, 100, 0, 1, $5, $6)
       RETURNING id, username, name, color, money, energy, xp, level, lat, lng`,
      [
        username,
        passwordHash,
        username,
        color,
        START.lat,
        START.lng
      ]
    );

    const player = result.rows[0];
    const token = createToken(player);

    res.json({
      token,
      player: publicPlayer(player)
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = clean(req.body?.username, 16);
    const password = req.body?.password;

    const result = await pool.query(
      `SELECT * FROM players WHERE LOWER(username) = LOWER($1)`,
      [username]
    );

    const player = result.rows[0];

    if (!player || !player.password_hash) {
      return res.status(401).json({
        error: 'Incorrect username or password.'
      });
    }

    const ok = await bcrypt.compare(password || '', player.password_hash);

    if (!ok) {
      return res.status(401).json({
        error: 'Incorrect username or password.'
      });
    }

    await pool.query(
      `UPDATE players SET updated_at = NOW() WHERE id = $1`,
      [player.id]
    );

    const token = createToken(player);

    res.json({
      token,
      player: publicPlayer(player)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Could not sign in.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({
    player: publicPlayer(req.player)
  });
});

/*
  Google login endpoint.

  It is ready for Google Identity Services once
  GOOGLE_CLIENT_ID is added to Railway.
*/
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!googleClient || !process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({
        error: 'Google login is not configured yet.'
      });
    }

    const credential = req.body?.credential;

    if (!credential) {
      return res.status(400).json({
        error: 'Google credential missing.'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({
        error: 'Invalid Google account.'
      });
    }

    const googleId = payload.sub;
    const email = payload.email;

    let result = await pool.query(
      `SELECT * FROM players WHERE google_id = $1`,
      [googleId]
    );

    let player = result.rows[0];

    if (!player) {
      /*
        Google accounts get an automatically generated username.
        The player can later change it from the profile system.
      */
      const base = clean(
        (payload.name || email.split('@')[0] || 'Player')
          .replace(/[^A-Za-z0-9_]/g, ''),
        12
      ) || 'Player';

      let username = base;
      let number = 1;

      while (true) {
        const check = await pool.query(
          `SELECT id FROM players WHERE LOWER(username) = LOWER($1)`,
          [username]
        );

        if (!check.rowCount) break;

        username = `${base.slice(0, 14)}${number}`;
        number++;
      }

      result = await pool.query(
        `INSERT INTO players
         (username, google_id, name, color, money, energy, xp, level, lat, lng)
         VALUES ($1, $2, $3, '#16a34a', 20000, 100, 0, 1, $4, $5)
         RETURNING *`,
        [
          username,
          googleId,
          clean(payload.name || username, 16),
          START.lat,
          START.lng
        ]
      );

      player = result.rows[0];
    }

    const token = createToken(player);

    res.json({
      token,
      player: publicPlayer(player)
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).json({
      error: 'Google sign-in could not be completed.'
    });
  }
});

/* =========================================================
   GAME WORLD
========================================================= */

const TYPES = {
  wealthy: { pay: 1.5, npc: 3 },
  middle: { pay: 1.2, npc: 4 },
  ordinary: { pay: 1, npc: 5 },
  commercial: { pay: 1.1, npc: 10 },
  older: { pay: 0.9, npc: 6 }
};

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
  { id: 'omiadio', name: 'Omi-Adio', type: 'ordinary', lat: 7.3760, lng: 3.8150, job: 'Farm hand', pay: 3000, xp: 8 }
];

const START = PLACES[0];

const byId = Object.fromEntries(
  PLACES.map(p => [p.id, p])
);

const meters = (a, b) =>
  Math.hypot(
    (a.lat - b.lat) * 111000,
    (a.lng - b.lng) *
      111000 *
      Math.cos(a.lat * Math.PI / 180)
  );

const nearest = p =>
  PLACES.find(pl => meters(p, pl) < 200);

const hour = () =>
  (Date.now() / 60000) % 24;

const ROLES = ['S', 'T', 'D', 'M', 'V', 'G'];

const npcs = [];

PLACES.forEach(h => {
  for (let k = 0; k < TYPES[h.type].npc; k++) {
    const w =
      Math.random() < 0.6
        ? h
        : PLACES[Math.floor(Math.random() * PLACES.length)];

    npcs.push({
      home: h,
      work: w,
      r: ROLES[Math.floor(Math.random() * ROLES.length)],
      lat: h.lat,
      lng: h.lng,
      off: [0, 0],
      shift: 6 + Math.random() * 2
    });
  }
});

const ROUTES = [
  ['mokola', 'dugbe', 'okeado', 'mapo', 'ringroad', 'challenge', 'oluyole', 'apata', 'odoona'],
  ['ui', 'bodija', 'sango', 'bashorun', 'akobo', 'iwo', 'newgarage', 'agodi'],
  ['jericho', 'eleyele', 'monatan', 'omiadio', 'mokola', 'agodi', 'dugbe'],
  ['dugbe', 'ringroad', 'newgarage', 'iwo', 'bashorun', 'bodija', 'ui', 'jericho']
];

const buses = ROUTES.map((r, i) => ({
  id: i,
  route: r,
  stop: 0,
  wait: 0,
  lat: byId[r[0]].lat,
  lng: byId[r[0]].lng
}));

function glide(o, t, step) {
  const d = meters(o, t);

  if (d <= step) {
    o.lat = t.lat;
    o.lng = t.lng;
    return true;
  }

  const f = step / d;

  o.lat += (t.lat - o.lat) * f;
  o.lng += (t.lng - o.lng) * f;

  return false;
}

/* =========================================================
   ACTIVE PLAYERS
========================================================= */

const players = {};

function publicPlayer(p) {
  return {
    id: String(p.id),
    username: p.username,
    name: p.name,
    color: p.color,
    money: Number(p.money),
    energy: Number(p.energy),
    xp: Number(p.xp),
    level: Number(p.level),
    lat: p.lat,
    lng: p.lng
  };
}

async function savePlayer(p) {
  if (!p || !p.accountId) return;

  try {
    await pool.query(
      `UPDATE players
       SET name = $1,
           color = $2,
           money = $3,
           energy = $4,
           xp = $5,
           level = $6,
           lat = $7,
           lng = $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        p.name,
        p.color,
        Math.round(p.money),
        Math.round(p.energy),
        Math.round(p.xp),
        Math.round(p.level),
        p.lat,
        p.lng,
        p.accountId
      ]
    );
  } catch (err) {
    console.error('Save player error:', err);
  }
}

async function sendMe(id, note) {
  const p = players[id];

  if (!p) return;

  io.to(id).emit('me', {
    money: Math.round(p.money),
    energy: Math.round(p.energy),
    level: p.level,
    xp: p.xp,
    need: p.level * 50,
    riding: p.bus !== null && p.bus !== undefined,
    note
  });
}

/* =========================================================
   WORLD LOOP
========================================================= */

setInterval(() => {
  const h = hour();

  for (const n of npcs) {
    const atWork = h >= n.shift && h < 17;
    const base = atWork ? n.work : n.home;

    if (Math.random() < 0.05) {
      n.off = [
        (Math.random() - 0.5) * 0.002,
        (Math.random() - 0.5) * 0.002
      ];
    }

    const night = h >= 21 || h < 5;

    glide(
      n,
      {
        lat: base.lat + n.off[0] * (night ? 0.3 : 1),
        lng: base.lng + n.off[1] * (night ? 0.3 : 1)
      },
      40
    );
  }

  for (const b of buses) {
    if (b.wait > 0) {
      b.wait--;
      continue;
    }

    const st = byId[b.route[b.stop]];

    if (glide(b, st, 70)) {
      b.stop = (b.stop + 1) % b.route.length;
      b.wait = 6;
    }
  }

  const r5 = x => Math.round(x * 1e5) / 1e5;

  io.emit('world', {
    h,
    npcs: npcs.map(n => [
      r5(n.lat),
      r5(n.lng),
      n.r
    ]),
    buses: buses.map(b => [
      b.id,
      r5(b.lat),
      r5(b.lng)
    ])
  });
}, 500);

/* =========================================================
   SOCKET AUTHENTICATION
========================================================= */

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Login required.'));
    }

    const player = await authFromToken(token);

    if (!player) {
      return next(new Error('Invalid login.'));
    }

    socket.account = player;

    next();
  } catch {
    next(new Error('Authentication failed.'));
  }
});

/* =========================================================
   GAME SOCKET
========================================================= */

io.on('connection', async socket => {
  const account = socket.account;

  let lat = account.lat;
  let lng = account.lng;

  if (!Number.isFinite(lat)) lat = START.lat;
  if (!Number.isFinite(lng)) lng = START.lng;

  players[socket.id] = {
    socketId: socket.id,
    accountId: Number(account.id),
    name: clean(account.name, 16) || 'Player',
    username: account.username,
    color: validColor(account.color)
      ? account.color
      : '#16a34a',

    lat,
    lng,
    target: null,

    money: Number(account.money),
    energy: Number(account.energy),
    xp: Number(account.xp),
    level: Number(account.level),

    lastWork: 0,
    lastChat: 0,
    bus: null
  };

  const p = players[socket.id];

  socket.emit('places', PLACES);

  await sendMe(
    socket.id,
    `Welcome back to Ibadan, ${p.name}!`
  );

  socket.on('moveTo', t => {
    if (
      p &&
      !p.bus &&
      t &&
      isFinite(t.lat) &&
      isFinite(t.lng)
    ) {
      p.target = {
        lat: +t.lat,
        lng: +t.lng
      };
    }
  });

  socket.on('work', async () => {
    if (!p) return;

    const pl = nearest(p);

    if (!pl) {
      return sendMe(
        p.socketId,
        'Walk to a location marker to work.'
      );
    }

    if (Date.now() - p.lastWork < 2500) return;

    if (p.energy < 10) {
      return sendMe(
        p.socketId,
        'Too tired. Eat something or wait.'
      );
    }

    p.lastWork = Date.now();
    p.energy -= 10;

    const pay = Math.round(
      pl.pay *
      TYPES[pl.type].pay *
      (1 + (p.level - 1) * 0.08)
    );

    p.money += pay;
    p.xp += pl.xp;

    while (p.xp >= p.level * 50) {
      p.xp -= p.level * 50;
      p.level++;
    }

    await savePlayer(p);

    sendMe(
      p.socketId,
      `${pl.job} at ${pl.name}: +₦${pay.toLocaleString()}`
    );
  });

  socket.on('eat', async () => {
    if (!p) return;

    const pl = nearest(p);

    if (!pl) {
      return sendMe(
        p.socketId,
        'Walk to a location to buy food.'
      );
    }

    if (p.money < 1500) {
      return sendMe(
        p.socketId,
        'Not enough money.'
      );
    }

    p.money -= 1500;
    p.energy = Math.min(100, p.energy + 40);

    await savePlayer(p);

    sendMe(
      p.socketId,
      `Ate amala at ${pl.name}: -₦1,500, +40 energy`
    );
  });

  socket.on('ride', async () => {
    if (!p) return;

    if (p.bus !== null) {
      p.bus = null;

      await savePlayer(p);

      return sendMe(
        p.socketId,
        'You got off the danfo.'
      );
    }

    const b = buses.find(
      b => meters(p, b) < 250
    );

    if (!b) {
      return sendMe(
        p.socketId,
        'No danfo nearby. Wait at a marker.'
      );
    }

    if (p.money < 200) {
      return sendMe(
        p.socketId,
        'Fare is ₦200. Not enough money.'
      );
    }

    p.money -= 200;
    p.bus = b.id;
    p.target = null;

    await savePlayer(p);

    sendMe(
      p.socketId,
      'You boarded the danfo (-₦200). Tap Get off to leave.'
    );
  });

  socket.on('chat', msg => {
    if (!p) return;

    const text = clean(msg, 140);

    if (
      !text ||
      Date.now() - p.lastChat < 800
    ) {
      return;
    }

    p.lastChat = Date.now();

    io.emit('chat', {
      name: p.name,
      text
    });
  });

  socket.on('disconnect', async () => {
    const leaving = players[socket.id];

    if (leaving) {
      await savePlayer(leaving);
      delete players[socket.id];
    }

    io.emit('left', socket.id);
  });
});

/* =========================================================
   ACTIVE PLAYER STATE
========================================================= */

setInterval(async () => {
  const list = [];

  for (const p of Object.values(players)) {
    if (
      p.bus !== null &&
      p.bus !== undefined
    ) {
      const b = buses[p.bus];

      if (b) {
        p.lat = b.lat;
        p.lng = b.lng;
      }
    } else if (p.target) {
      const d = meters(p, p.target);
      const step = 8;

      if (d <= step) {
        p.lat = p.target.lat;
        p.lng = p.target.lng;
        p.target = null;
      } else {
        const f = step / d;

        p.lat +=
          (p.target.lat - p.lat) * f;

        p.lng +=
          (p.target.lng - p.lng) * f;
      }
    }

    list.push({
      id: String(p.accountId),
      name: p.name,
      color: p.color,
      lat: p.lat,
      lng: p.lng,
      level: p.level
    });
  }

  io.emit('state', list);
}, 200);

/* =========================================================
   ENERGY + PERIODIC SAVING
========================================================= */

setInterval(async () => {
  for (const p of Object.values(players)) {
    p.energy = Math.min(
      100,
      p.energy + 1
    );

    sendMe(p.socketId);

    await savePlayer(p);
  }
}, 5000);

/* =========================================================
   HEALTH
========================================================= */

app.get('/health', (req, res) => {
  res.send('ok');
});

/* =========================================================
   START SERVER
========================================================= */

initDatabase()
  .then(() => {
    srv.listen(PORT, () => {
      console.log(
        `Ibadan Life running on port ${PORT}`
      );
    });
  })
  .catch(err => {
    console.error(
      'Database initialization failed:',
      err
    );
    process.exit(1);
  });
