const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const srv = http.createServer(app);

const io = new Server(srv, {
  cors: {
    origin: true,
    credentials: true
  }
});

app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'CHANGE_THIS_SECRET_IN_RAILWAY';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

if (JWT_SECRET === 'CHANGE_THIS_SECRET_IN_RAILWAY') {
  console.warn(
    'WARNING: JWT_SECRET is not configured in Railway.'
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const googleClient =
  process.env.GOOGLE_CLIENT_ID
    ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
    : null;


/* =========================================================
   BACKGROUNDS
   ========================================================= */

const BACKGROUNDS = {
  nepo: {
    type: 'Nepo Baby',
    minMoney: 50000,
    maxMoney: 70000
  },

  lapo: {
    type: 'Lapo Baby',
    minMoney: 5000,
    maxMoney: 10000
  }
};

function randomInt(min, max) {
  return Math.floor(
    Math.random() *
      (max - min + 1)
  ) + min;
}

function randomItem(items) {
  return items[
    Math.floor(
      Math.random() *
      items.length
    )
  ];
}

function weightedRandomItem(items, weightFn) {
  if (!items.length) return null;

  let total = 0;

  for (const item of items) {
    const weight = Math.max(
      0,
      Number(weightFn(item)) || 0
    );

    total += weight;
  }

  if (total <= 0) {
    return randomItem(items);
  }

  let roll = Math.random() * total;

  for (const item of items) {
    const weight = Math.max(
      0,
      Number(weightFn(item)) || 0
    );

    roll -= weight;

    if (roll <= 0) {
      return item;
    }
  }

  return items[items.length - 1];
}


/* =========================================================
   GAME WORLD TYPES
   ========================================================= */

const TYPES = {
  wealthy: {
    pay: 1.5,
    npc: 4
  },

  middle: {
    pay: 1.2,
    npc: 5
  },

  ordinary: {
    pay: 1,
    npc: 6
  },

  commercial: {
    pay: 1.1,
    npc: 11
  },

  older: {
    pay: 0.9,
    npc: 7
  }
};


/* =========================================================
   IBADAN WORLD
   =========================================================
   These are game-world locations used for:
   - jobs
   - NPC spawning
   - danfo routes
   - player starting locations
   - map markers

   The coordinates are approximate game-world coordinates.
   ========================================================= */

const PLACES = [

  /* =========================
     CENTRAL / OLD IBADAN
     ========================= */

  {
    id: 'mokola',
    name: 'Mokola',
    type: 'middle',
    lat: 7.4040,
    lng: 3.8990,
    job: 'Bus conductor',
    pay: 2500,
    xp: 6,
    spawn: {
      nepo: 2,
      lapo: 2
    }
  },

  {
    id: 'dugbe',
    name: 'Dugbe Market',
    type: 'commercial',
    lat: 7.3890,
    lng: 3.8830,
    job: 'Market trader',
    pay: 3000,
    xp: 7,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'mapo',
    name: 'Mapo Hall',
    type: 'older',
    lat: 7.3880,
    lng: 3.8960,
    job: 'Tour guide',
    pay: 3700,
    xp: 9,
    spawn: {
      nepo: 1.5,
      lapo: 2
    }
  },

  {
    id: 'okeado',
    name: 'Oke-Ado',
    type: 'older',
    lat: 7.3800,
    lng: 3.8900,
    job: 'Bakery helper',
    pay: 2800,
    xp: 6,
    spawn: {
      nepo: 1.5,
      lapo: 2.5
    }
  },

  {
    id: 'cocoa',
    name: 'Cocoa House',
    type: 'commercial',
    lat: 7.3867,
    lng: 3.8995,
    job: 'Office assistant',
    pay: 4200,
    xp: 10,
    spawn: {
      nepo: 2,
      lapo: 2
    }
  },

  {
    id: 'gate',
    name: 'Gate',
    type: 'commercial',
    lat: 7.3960,
    lng: 3.9180,
    job: 'Phone accessories seller',
    pay: 3200,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'agodi',
    name: 'Agodi',
    type: 'middle',
    lat: 7.4000,
    lng: 3.9080,
    job: 'Hospital porter',
    pay: 3600,
    xp: 9,
    spawn: {
      nepo: 2,
      lapo: 2
    }
  },

  {
    id: 'agodi_gardens',
    name: 'Agodi Gardens',
    type: 'middle',
    lat: 7.4070,
    lng: 3.9090,
    job: 'Park attendant',
    pay: 3800,
    xp: 9,
    spawn: {
      nepo: 2.5,
      lapo: 2
    }
  },


  /* =========================
     UNIVERSITY / STUDENT AREA
     ========================= */

  {
    id: 'ui',
    name: 'University of Ibadan',
    type: 'middle',
    lat: 7.4443,
    lng: 3.9000,
    job: 'Campus tutor',
    pay: 4500,
    xp: 12,
    spawn: {
      nepo: 4,
      lapo: 4
    }
  },

  {
    id: 'samonda',
    name: 'Samonda',
    type: 'middle',
    lat: 7.4480,
    lng: 3.9160,
    job: 'Student food vendor',
    pay: 3600,
    xp: 9,
    spawn: {
      nepo: 3,
      lapo: 4
    }
  },

  {
    id: 'agbowo',
    name: 'Agbowo',
    type: 'ordinary',
    lat: 7.4540,
    lng: 3.9050,
    job: 'Bookshop assistant',
    pay: 3300,
    xp: 8,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },

  {
    id: 'sasa',
    name: 'Sasa',
    type: 'ordinary',
    lat: 7.4670,
    lng: 3.9200,
    job: 'Food seller',
    pay: 3100,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'orogun',
    name: 'Orogun',
    type: 'ordinary',
    lat: 7.4560,
    lng: 3.9350,
    job: 'Delivery rider',
    pay: 3400,
    xp: 8,
    spawn: {
      nepo: 2,
      lapo: 3
    }
  },

  {
    id: 'leadcity',
    name: 'Lead City University',
    type: 'wealthy',
    lat: 7.4850,
    lng: 3.9420,
    job: 'Campus assistant',
    pay: 4800,
    xp: 13,
    spawn: {
      nepo: 4,
      lapo: 3
    }
  },

  {
    id: 'dominican',
    name: 'Dominican University',
    type: 'middle',
    lat: 7.5020,
    lng: 3.9000,
    job: 'School assistant',
    pay: 4500,
    xp: 12,
    spawn: {
      nepo: 3,
      lapo: 3
    }
  },

  {
    id: 'polyibadan',
    name: 'The Polytechnic Ibadan',
    type: 'middle',
    lat: 7.4050,
    lng: 3.9700,
    job: 'Polytechnic tutor',
    pay: 4400,
    xp: 12,
    spawn: {
      nepo: 3,
      lapo: 4
    }
  },

  {
    id: 'poly_sango',
    name: 'Polytechnic / Sango',
    type: 'commercial',
    lat: 7.4150,
    lng: 3.9500,
    job: 'Student vendor',
    pay: 3700,
    xp: 9,
    spawn: {
      nepo: 2.5,
      lapo: 4
    }
  },


  /* =========================
     WEST / NORTH-WEST
     ========================= */

  {
    id: 'jericho',
    name: 'Jericho',
    type: 'wealthy',
    lat: 7.4150,
    lng: 3.8950,
    job: 'Restaurant waiter',
    pay: 3000,
    xp: 7,
    spawn: {
      nepo: 6,
      lapo: 1
    }
  },

  {
    id: 'idiishin',
    name: 'Idi-Ishin',
    type: 'middle',
    lat: 7.4210,
    lng: 3.8750,
    job: 'Pharmacy assistant',
    pay: 3900,
    xp: 10,
    spawn: {
      nepo: 3,
      lapo: 2
    }
  },

  {
    id: 'ologuneru',
    name: 'Ologuneru',
    type: 'ordinary',
    lat: 7.4310,
    lng: 3.8420,
    job: 'Shop assistant',
    pay: 3200,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'eleyele',
    name: 'Eleyele',
    type: 'ordinary',
    lat: 7.4160,
    lng: 3.8550,
    job: 'Fish seller',
    pay: 2900,
    xp: 7,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'monatan',
    name: 'Monatan',
    type: 'ordinary',
    lat: 7.4080,
    lng: 3.8440,
    job: 'Delivery rider',
    pay: 3200,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'omiadio',
    name: 'Omi-Adio',
    type: 'ordinary',
    lat: 7.3760,
    lng: 3.8150,
    job: 'Farm hand',
    pay: 3000,
    xp: 8,
    spawn: {
      nepo: 1,
      lapo: 3
    }
  },

  {
    id: 'apete',
    name: 'Apete',
    type: 'ordinary',
    lat: 7.4250,
    lng: 3.8270,
    job: 'Building worker',
    pay: 3400,
    xp: 8,
    spawn: {
      nepo: 2,
      lapo: 3.5
    }
  },

  {
    id: 'ajibode',
    name: 'Ajibode',
    type: 'ordinary',
    lat: 7.4620,
    lng: 3.8450,
    job: 'Farm produce seller',
    pay: 3200,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'ijokodo',
    name: 'Ijokodo',
    type: 'ordinary',
    lat: 7.4510,
    lng: 3.8650,
    job: 'Mechanic assistant',
    pay: 3500,
    xp: 9,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },


  /* =========================
     BODIJA / NORTH
     ========================= */

  {
    id: 'bodija',
    name: 'Bodija',
    type: 'wealthy',
    lat: 7.4300,
    lng: 3.9100,
    job: 'Provisions seller',
    pay: 3500,
    xp: 8,
    spawn: {
      nepo: 7,
      lapo: 1.5
    }
  },

  {
    id: 'bodijamarket',
    name: 'Bodija Market',
    type: 'commercial',
    lat: 7.4310,
    lng: 3.9180,
    job: 'Market trader',
    pay: 3800,
    xp: 9,
    spawn: {
      nepo: 3,
      lapo: 4
    }
  },

  {
    id: 'newbodija',
    name: 'New Bodija',
    type: 'wealthy',
    lat: 7.4360,
    lng: 3.9200,
    job: 'Estate assistant',
    pay: 4200,
    xp: 10,
    spawn: {
      nepo: 6,
      lapo: 1.5
    }
  },

  {
    id: 'sango',
    name: 'Sango',
    type: 'middle',
    lat: 7.4220,
    lng: 3.9200,
    job: 'Tailor assistant',
    pay: 3400,
    xp: 8,
    spawn: {
      nepo: 3,
      lapo: 3
    }
  },

  {
    id: 'akobo',
    name: 'Akobo',
    type: 'ordinary',
    lat: 7.4350,
    lng: 3.9650,
    job: 'Shop attendant',
    pay: 3300,
    xp: 8,
    spawn: {
      nepo: 3,
      lapo: 3
    }
  },

  {
    id: 'bashorun',
    name: 'Bashorun',
    type: 'wealthy',
    lat: 7.4180,
    lng: 3.9380,
    job: 'Estate caretaker',
    pay: 3900,
    xp: 9,
    spawn: {
      nepo: 6,
      lapo: 1.5
    }
  },

  {
    id: 'ojoo',
    name: 'Ojoo',
    type: 'commercial',
    lat: 7.4680,
    lng: 3.9470,
    job: 'Transport worker',
    pay: 3700,
    xp: 9,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },


  /* =========================
     EAST / SOUTH-EAST
     ========================= */

  {
    id: 'iwo',
    name: 'Iwo Road',
    type: 'commercial',
    lat: 7.3930,
    lng: 3.9420,
    job: 'Dispatch rider',
    pay: 3600,
    xp: 9,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },

  {
    id: 'newgarage',
    name: 'New Garage',
    type: 'commercial',
    lat: 7.3590,
    lng: 3.9130,
    job: 'Park loader',
    pay: 3300,
    xp: 8,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },

  {
    id: 'challenge',
    name: 'Challenge',
    type: 'commercial',
    lat: 7.3470,
    lng: 3.8780,
    job: 'Mechanic helper',
    pay: 3800,
    xp: 9,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },

  {
    id: 'ringroad',
    name: 'Ring Road',
    type: 'commercial',
    lat: 7.3620,
    lng: 3.8760,
    job: 'Okada rider',
    pay: 3200,
    xp: 8,
    spawn: {
      nepo: 3,
      lapo: 4
    }
  },

  {
    id: 'molete',
    name: 'Molete',
    type: 'commercial',
    lat: 7.3690,
    lng: 3.8870,
    job: 'Auto parts seller',
    pay: 3700,
    xp: 9,
    spawn: {
      nepo: 2,
      lapo: 4
    }
  },

  {
    id: 'odogbo',
    name: 'Odogbo',
    type: 'ordinary',
    lat: 7.3500,
    lng: 3.9100,
    job: 'Welder assistant',
    pay: 3300,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'oluyole',
    name: 'Oluyole',
    type: 'wealthy',
    lat: 7.3560,
    lng: 3.8800,
    job: 'Security guard',
    pay: 4200,
    xp: 10,
    spawn: {
      nepo: 6,
      lapo: 1.5
    }
  },

  {
    id: 'odoona',
    name: 'Odo-Ona',
    type: 'older',
    lat: 7.3640,
    lng: 3.8530,
    job: 'Welder helper',
    pay: 3100,
    xp: 8,
    spawn: {
      nepo: 1.5,
      lapo: 3
    }
  },

  {
    id: 'apata',
    name: 'Apata',
    type: 'ordinary',
    lat: 7.3500,
    lng: 3.8550,
    job: 'Brick layer',
    pay: 4000,
    xp: 10,
    spawn: {
      nepo: 1.5,
      lapo: 3.5
    }
  },


  /* =========================
     SOUTH / SOUTH-WEST
     ========================= */

  {
    id: 'iyaganku',
    name: 'Iyaganku',
    type: 'middle',
    lat: 7.3740,
    lng: 3.8830,
    job: 'Office clerk',
    pay: 3900,
    xp: 10,
    spawn: {
      nepo: 3,
      lapo: 2.5
    }
  },

  {
    id: 'palms',
    name: 'The Palms / Ring Road',
    type: 'commercial',
    lat: 7.3560,
    lng: 3.8690,
    job: 'Shop assistant',
    pay: 3800,
    xp: 9,
    spawn: {
      nepo: 3,
      lapo: 3
    }
  },

  {
    id: 'jericho_gra',
    name: 'Jericho GRA',
    type: 'wealthy',
    lat: 7.4070,
    lng: 3.8860,
    job: 'Estate worker',
    pay: 4300,
    xp: 10,
    spawn: {
      nepo: 7,
      lapo: 1
    }
  }
];


/* =========================================================
   PLACE INDEX
   ========================================================= */

const byId =
  Object.fromEntries(
    PLACES.map(place => [
      place.id,
      place
    ])
  );

const START =
  byId.mokola || PLACES[0];

function backgroundPlace(neighborhood) {
  return byId[neighborhood] || START;
}


/* =========================================================
   RANDOM STARTING BACKGROUND
   =========================================================
   IMPORTANT:
   Players are NOT locked to rich or poor areas.

   Every location has both a Nepo and Lapo weight.
   Premium areas strongly favor Nepo.
   Student/commercial/ordinary areas give Lapo a higher chance.
   But BOTH backgrounds can appear throughout Ibadan.
   ========================================================= */

function createRandomBackground() {

  const isNepo =
    Math.random() < 0.5;

  const key =
    isNepo
      ? 'nepo'
      : 'lapo';

  const background =
    BACKGROUNDS[key];

  const neighborhood =
    weightedRandomItem(
      PLACES,
      place => {

        if (
          place.spawn &&
          typeof place.spawn[key] === 'number'
        ) {
          return place.spawn[key];
        }

        return 1;
      }
    );

  return {
    type: background.type,

    neighborhood:
      neighborhood
        ? neighborhood.id
        : START.id,

    money:
      randomInt(
        background.minMoney,
        background.maxMoney
      )
  };
}


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
      email TEXT,
      recovery_token_hash TEXT,
      recovery_expires_at TIMESTAMPTZ,
      name VARCHAR(16),
      color VARCHAR(7) DEFAULT '#16a34a',
      money BIGINT DEFAULT 20000,
      energy INTEGER DEFAULT 100,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      background_type TEXT,
      background_neighborhood TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS email TEXT
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS recovery_token_hash TEXT
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS recovery_expires_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS background_type TEXT
  `);

  await pool.query(`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS background_neighborhood TEXT
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      token_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      receiver_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      receiver_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_transactions (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      amount BIGINT,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_requests (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      receiver_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      amount BIGINT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      item_name TEXT,
      quantity INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      property_name TEXT,
      price BIGINT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT REFERENCES players(id) ON DELETE CASCADE,
      vehicle_name TEXT,
      price BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('Database ready.');
}


/* =========================================================
   HELPERS
   ========================================================= */

function clean(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,16}$/.test(
    username
  );
}

function validPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 6 &&
    password.length <= 100
  );
}

function validEmail(email) {
  return (
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254
  );
}

function validColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color);
}

function hashRecoveryToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

function createRecoveryToken() {
  return crypto
    .randomBytes(32)
    .toString('hex');
}

function createToken(player) {
  return jwt.sign(
    {
      sub: String(player.id),
      username: player.username
    },
    JWT_SECRET,
    {
      expiresIn: '30d'
    }
  );
}


/* =========================================================
   PLAYER DATABASE FUNCTIONS
   ========================================================= */

async function getPlayerById(id) {

  const result =
    await pool.query(
      `
      SELECT
        id,
        username,
        password_hash,
        google_id,
        email,
        name,
        color,
        money,
        energy,
        xp,
        level,
        lat,
        lng,
        background_type,
        background_neighborhood
      FROM players
      WHERE id = $1
      `,
      [id]
    );

  return result.rows[0] || null;
}


function publicPlayer(player) {

  return {
    id: String(player.id),

    username:
      player.username,

    name:
      player.name,

    color:
      player.color,

    money:
      Number(player.money),

    energy:
      Number(player.energy),

    xp:
      Number(player.xp),

    level:
      Number(player.level),

    lat:
      player.lat,

    lng:
      player.lng,

    backgroundType:
      player.background_type || null,

    backgroundNeighborhood:
      player.background_neighborhood || null
  };
}


async function savePlayer(player) {

  await pool.query(
    `
    UPDATE players
    SET
      name = $1,
      color = $2,
      money = $3,
      energy = $4,
      xp = $5,
      level = $6,
      lat = $7,
      lng = $8,
      updated_at = NOW()
    WHERE id = $9
    `,
    [
      player.name,
      player.color,
      player.money,
      player.energy,
      player.xp,
      player.level,
      player.lat,
      player.lng,
      player.id
    ]
  );
}


/* =========================================================
   AUTH MIDDLEWARE
   ========================================================= */

async function authMiddleware(
  req,
  res,
  next
) {

  try {

    const header =
      req.headers.authorization || '';

    const token =
      header.startsWith('Bearer ')
        ? header.slice(7)
        : null;

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required.'
      });
    }

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const player =
      await getPlayerById(
        decoded.sub
      );

    if (!player) {
      return res.status(401).json({
        error: 'Player not found.'
      });
    }

    req.player = player;

    next();

  } catch (err) {

    return res.status(401).json({
      error: 'Invalid or expired token.'
    });
  }
}


/* =========================================================
   SIGNUP
   ========================================================= */

app.post(
  '/api/auth/signup',
  async (req, res) => {

    try {

      const username =
        clean(
          req.body.username,
          16
        );

      const password =
        req.body.password;

      const confirmPassword =
        req.body.confirmPassword;

      const email =
        clean(
          req.body.email,
          254
        );

      const name =
        clean(
          req.body.name || username,
          16
        );

      const color =
        clean(
          req.body.color ||
            '#16a34a',
          7
        );

      if (!validUsername(username)) {
        return res.status(400).json({
          error:
            'Username must be 3-16 characters and use only letters, numbers, or _.'
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            'Password must be 6-100 characters.'
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          error:
            'Passwords do not match.'
        });
      }

      if (
        email &&
        !validEmail(email)
      ) {
        return res.status(400).json({
          error:
            'Invalid email address.'
        });
      }

      if (!validColor(color)) {
        return res.status(400).json({
          error:
            'Invalid player color.'
        });
      }


      const existing =
        await pool.query(
          `
          SELECT id
          FROM players
          WHERE LOWER(username) = LOWER($1)
             OR (
               $2 <> ''
               AND LOWER(email) = LOWER($2)
             )
          LIMIT 1
          `,
          [
            username,
            email
          ]
        );

      if (existing.rows.length) {
        return res.status(409).json({
          error:
            'Username or email already exists.'
        });
      }


      const background =
        createRandomBackground();

      const startingPlace =
        backgroundPlace(
          background.neighborhood
        );

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );


      const result =
        await pool.query(
          `
          INSERT INTO players (
            username,
            password_hash,
            email,
            name,
            color,
            money,
            energy,
            xp,
            level,
            lat,
            lng,
            background_type,
            background_neighborhood
          )
          VALUES (
            $1,$2,$3,$4,$5,
            $6,100,0,1,
            $7,$8,$9,$10
          )
          RETURNING *
          `,
          [
            username,
            passwordHash,
            email || null,
            name || username,
            color,
            background.money,
            startingPlace.lat,
            startingPlace.lng,
            background.type,
            background.neighborhood
          ]
        );


      const player =
        result.rows[0];

      const token =
        createToken(player);

      return res.json({
        token,
        player:
          publicPlayer(player),

        background: {
          type:
            background.type,

          neighborhood:
            startingPlace.name,

          money:
            background.money
        }
      });

    } catch (err) {

      console.error(
        'Signup error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not create account.'
      });
    }
  }
);


/* =========================================================
   LOGIN
   ========================================================= */

app.post(
  '/api/auth/login',
  async (req, res) => {

    try {

      const username =
        clean(
          req.body.username,
          16
        );

      const password =
        req.body.password;

      const result =
        await pool.query(
          `
          SELECT *
          FROM players
          WHERE LOWER(username) = LOWER($1)
          LIMIT 1
          `,
          [username]
        );

      const player =
        result.rows[0];

      if (
        !player ||
        !player.password_hash
      ) {
        return res.status(401).json({
          error:
            'Invalid username or password.'
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          player.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          error:
            'Invalid username or password.'
        });
      }

      const token =
        createToken(player);

      return res.json({
        token,
        player:
          publicPlayer(player)
      });

    } catch (err) {

      console.error(
        'Login error:',
        err
      );

      return res.status(500).json({
        error:
          'Login failed.'
      });
    }
  }
);


/* =========================================================
   CURRENT USER
   ========================================================= */

app.get(
  '/api/auth/me',
  authMiddleware,
  async (req, res) => {

    return res.json({
      player:
        publicPlayer(
          req.player
        )
    });
  }
);


/* =========================================================
   PASSWORD RECOVERY REQUEST
   ========================================================= */

app.post(
  '/api/auth/recovery',
  async (req, res) => {

    try {

      const email =
        clean(
          req.body.email,
          254
        );

      if (!validEmail(email)) {
        return res.status(400).json({
          error:
            'Enter a valid email.'
        });
      }

      const result =
        await pool.query(
          `
          SELECT id
          FROM players
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [email]
        );

      if (!result.rows.length) {

        return res.json({
          message:
            'If that email exists, a recovery link has been created.'
        });
      }

      const token =
        createRecoveryToken();

      const tokenHash =
        hashRecoveryToken(token);

      await pool.query(
        `
        UPDATE players
        SET
          recovery_token_hash = $1,
          recovery_expires_at =
            NOW() + INTERVAL '30 minutes'
        WHERE id = $2
        `,
        [
          tokenHash,
          result.rows[0].id
        ]
      );

      console.log(
        `Password recovery token for ${email}: ${token}`
      );

      return res.json({
        message:
          'Recovery instructions created.',
        recoveryToken:
          token
      });

    } catch (err) {

      console.error(
        'Recovery error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not create recovery request.'
      });
    }
  }
);


/* =========================================================
   PASSWORD RESET
   ========================================================= */

app.post(
  '/api/auth/reset-password',
  async (req, res) => {

    try {

      const token =
        clean(
          req.body.token,
          128
        );

      const password =
        req.body.password;

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            'Password must be 6-100 characters.'
        });
      }

      const tokenHash =
        hashRecoveryToken(token);

      const result =
        await pool.query(
          `
          SELECT id
          FROM players
          WHERE recovery_token_hash = $1
            AND recovery_expires_at > NOW()
          LIMIT 1
          `,
          [tokenHash]
        );

      if (!result.rows.length) {
        return res.status(400).json({
          error:
            'Recovery token is invalid or expired.'
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      await pool.query(
        `
        UPDATE players
        SET
          password_hash = $1,
          recovery_token_hash = NULL,
          recovery_expires_at = NULL,
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          passwordHash,
          result.rows[0].id
        ]
      );

      return res.json({
        message:
          'Password successfully changed.'
      });

    } catch (err) {

      console.error(
        'Reset error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not reset password.'
      });
    }
  }
);


/* =========================================================
   GOOGLE LOGIN
   ========================================================= */

app.post(
  '/api/auth/google',
  async (req, res) => {

    try {

      if (!googleClient) {
        return res.status(503).json({
          error:
            'Google login is not configured.'
        });
      }

      const credential =
        req.body.credential;

      if (!credential) {
        return res.status(400).json({
          error:
            'Google credential is required.'
        });
      }

      const ticket =
        await googleClient.verifyIdToken({
          idToken: credential,
          audience:
            process.env.GOOGLE_CLIENT_ID
        });

      const payload =
        ticket.getPayload();

      const googleId =
        payload.sub;

      const email =
        payload.email || '';

      const googleName =
        clean(
          payload.name ||
            'Player',
          16
        );


      let result =
        await pool.query(
          `
          SELECT *
          FROM players
          WHERE google_id = $1
          LIMIT 1
          `,
          [googleId]
        );

      let player =
        result.rows[0];


      /* Existing Google account */

      if (player) {

        const token =
          createToken(player);

        return res.json({
          token,
          player:
            publicPlayer(player)
        });
      }


      /* Existing email account */

      if (email) {

        result =
          await pool.query(
            `
            SELECT *
            FROM players
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [email]
          );

        player =
          result.rows[0];

        if (player) {

          await pool.query(
            `
            UPDATE players
            SET
              google_id = $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [
              googleId,
              player.id
            ]
          );

          player.google_id =
            googleId;

          const token =
            createToken(player);

          return res.json({
            token,
            player:
              publicPlayer(player)
          });
        }
      }


      /* New Google account */

      let baseUsername =
        googleName
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 12)
          .toLowerCase();

      if (
        !baseUsername ||
        baseUsername.length < 3
      ) {
        baseUsername =
          'player';
      }

      let username =
        baseUsername;

      for (let i = 0; i < 100; i++) {

        const check =
          await pool.query(
            `
            SELECT id
            FROM players
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username]
          );

        if (!check.rows.length) {
          break;
        }

        username =
          `${baseUsername}${randomInt(
            100,
            9999
          )}`.slice(0, 16);
      }


      const background =
        createRandomBackground();

      const startingPlace =
        backgroundPlace(
          background.neighborhood
        );


      result =
        await pool.query(
          `
          INSERT INTO players (
            username,
            google_id,
            email,
            name,
            color,
            money,
            energy,
            xp,
            level,
            lat,
            lng,
            background_type,
            background_neighborhood
          )
          VALUES (
            $1,$2,$3,$4,$5,
            $6,100,0,1,
            $7,$8,$9,$10
          )
          RETURNING *
          `,
          [
            username,
            googleId,
            email || null,
            googleName || username,
            '#16a34a',
            background.money,
            startingPlace.lat,
            startingPlace.lng,
            background.type,
            background.neighborhood
          ]
        );

      player =
        result.rows[0];

      const token =
        createToken(player);

      return res.json({
        token,
        player:
          publicPlayer(player)
      });

    } catch (err) {

      console.error(
        'Google login error:',
        err
      );

      return res.status(500).json({
        error:
          'Google login failed.'
      });
    }
  }
);


/* =========================================================
   GAME MATH
   ========================================================= */

function meters(a, b) {

  return Math.hypot(
    (a.lat - b.lat) * 111000,

    (a.lng - b.lng) *
      111000 *
      Math.cos(
        a.lat *
          Math.PI /
          180
      )
  );
}


function nearest(player) {

  let closest = null;
  let closestDistance =
    Infinity;

  for (const place of PLACES) {

    const distance =
      meters(
        player,
        place
      );

    if (
      distance <
      closestDistance
    ) {
      closestDistance =
        distance;

      closest =
        place;
    }
  }

  if (
    closest &&
    closestDistance <= 220
  ) {
    return closest;
  }

  return null;
}


function hour() {

  const now =
    new Date();

  return (
    now.getHours() +
    now.getMinutes() / 60
  );
}


/* =========================================================
   NPCs
   ========================================================= */

const ROLES = [
  'S',
  'T',
  'D',
  'M',
  'V',
  'G'
];

const npcs = [];

PLACES.forEach(home => {

  const config =
    TYPES[home.type] ||
    TYPES.ordinary;

  for (
    let k = 0;
    k < config.npc;
    k++
  ) {

    const work =
      Math.random() < 0.6
        ? home
        : randomItem(PLACES);

    npcs.push({

      home,

      work,

      r:
        randomItem(ROLES),

      lat:
        home.lat,

      lng:
        home.lng,

      off: [
        0,
        0
      ],

      shift:
        6 +
        Math.random() * 2
    });
  }
});


/* =========================================================
   DANFO ROUTES
   ========================================================= */

const ROUTES = [

  /* Central -> South */

  [
    'mokola',
    'dugbe',
    'okeado',
    'mapo',
    'cocoa',
    'iyaganku',
    'ringroad',
    'challenge',
    'oluyole',
    'apata'
  ],

  /* North -> East */

  [
    'ui',
    'samonda',
    'bodija',
    'newbodija',
    'sango',
    'bashorun',
    'poly_sango',
    'polyibadan',
    'iwo',
    'akobo'
  ],

  /* West corridor */

  [
    'jericho',
    'idiishin',
    'eleyele',
    'ologuneru',
    'apete',
    'ajibode',
    'ijokodo',
    'ui'
  ],

  /* South corridor */

  [
    'dugbe',
    'okeado',
    'ringroad',
    'molete',
    'newgarage',
    'odogbo',
    'odoona',
    'oluyole'
  ],

  /* University route */

  [
    'ui',
    'agbowo',
    'sasa',
    'orogun',
    'ojoo',
    'samonda',
    'ui'
  ],

  /* East / Polytechnic route */

  [
    'gate',
    'agodi',
    'iwo',
    'poly_sango',
    'polyibadan',
    'akobo',
    'bashorun'
  ],

  /* West / Omi-Adio */

  [
    'jericho_gra',
    'jericho',
    'eleyele',
    'monatan',
    'omiadio',
    'apata',
    'oluyole'
  ],

  /* Central commercial route */

  [
    'dugbe',
    'cocoa',
    'mapo',
    'gate',
    'agodi',
    'mokola',
    'sango',
    'bodija'
  ]
];


const buses =
  ROUTES
    .filter(route =>
      route.every(
        id => byId[id]
      )
    )
    .map(
      (route, index) => {

        const first =
          byId[route[0]];

        return {

          id: index,

          route,

          stop: 0,

          wait: 0,

          lat:
            first.lat,

          lng:
            first.lng
        };
      }
    );


function glide(object, target, speed) {

  const dx =
    target.lng -
    object.lng;

  const dy =
    target.lat -
    object.lat;

  const distance =
    Math.hypot(
      dx,
      dy
    );

  if (
    distance < 0.00001
  ) {
    return true;
  }

  const step =
    speed / 111000;

  if (
    distance <= step
  ) {

    object.lat =
      target.lat;

    object.lng =
      target.lng;

    return true;
  }

  object.lat +=
    (dy / distance) *
    step;

  object.lng +=
    (dx / distance) *
    step;

  return false;
}


/* =========================================================
   ACTIVE PLAYERS
   ========================================================= */

const players = {};


async function authFromToken(token) {

  try {

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    return await getPlayerById(
      decoded.sub
    );

  } catch (err) {

    return null;
  }
}


/* =========================================================
   SEND PLAYER DATA
   ========================================================= */

function sendMe(
  socket,
  player,
  note = ''
) {

  socket.emit(
    'me',
    {
      money:
        player.money,

      energy:
        player.energy,

      level:
        player.level,

      xp:
        player.xp,

      need:
        100 -
        player.energy,

      riding:
        player.riding
          ? true
          : false,

      backgroundType:
        player.backgroundType ||
        null,

      backgroundNeighborhood:
        player.backgroundNeighborhood ||
        null,

      note
    }
  );
}


/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on(
  'connection',
  async socket => {

    try {

      const token =
        socket.handshake.auth &&
        socket.handshake.auth.token;

      const account =
        await authFromToken(
          token
        );

      if (!account) {

        socket.emit(
          'authError',
          {
            error:
              'Authentication failed.'
          }
        );

        socket.disconnect();

        return;
      }


      const startingPlace =
        backgroundPlace(
          account.background_neighborhood
        );


      const player = {

        id:
          String(account.id),

        dbId:
          account.id,

        username:
          account.username,

        name:
          account.name ||
          account.username,

        color:
          account.color ||
          '#16a34a',

        money:
          Number(account.money),

        energy:
          Number(account.energy),

        xp:
          Number(account.xp),

        level:
          Number(account.level),

        lat:
          account.lat ??
          startingPlace.lat,

        lng:
          account.lng ??
          startingPlace.lng,

        targetLat:
          account.lat ??
          startingPlace.lat,

        targetLng:
          account.lng ??
          startingPlace.lng,

        riding:
          null,

        workCooldown:
          0,

        chatCooldown:
          0,

        backgroundType:
          account.background_type ||
          null,

        backgroundNeighborhood:
          account.background_neighborhood ||
          null
      };


      players[
        player.id
      ] = player;


      socket.account =
        player;


      socket.emit(
        'places',
        PLACES.map(place => ({
          id:
            place.id,

          name:
            place.name,

          type:
            place.type,

          lat:
            place.lat,

          lng:
            place.lng,

          job:
            place.job,

          pay:
            place.pay,

          xp:
            place.xp
        }))
      );


      sendMe(
        socket,
        player,
        player.backgroundType
          ? `You are a ${player.backgroundType} starting around ${startingPlace.name}.`
          : 'Welcome to Ibadan Life.'
      );


      socket.on(
        'moveTo',
        data => {

          if (
            player.riding !== null
          ) {
            return;
          }

          const lat =
            Number(data.lat);

          const lng =
            Number(data.lng);

          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
          ) {
            return;
          }

          if (
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          ) {
            return;
          }

          player.targetLat =
            lat;

          player.targetLng =
            lng;
        }
      );


      /* =====================================================
         WORK
         ===================================================== */

      socket.on(
        'work',
        async () => {

          const now =
            Date.now();

          if (
            now <
            player.workCooldown
          ) {
            return sendMe(
              socket,
              player,
              'Slow down.'
            );
          }

          if (
            player.riding !== null
          ) {
            return sendMe(
              socket,
              player,
              'Get off the bus first.'
            );
          }

          if (
            player.energy < 10
          ) {
            return sendMe(
              socket,
              player,
              'You are too tired. Eat or wait.'
            );
          }

          const place =
            nearest(player);

          if (!place) {
            return sendMe(
              socket,
              player,
              'Move closer to a workplace.'
            );
          }


          const type =
            TYPES[place.type] ||
            TYPES.ordinary;


          const levelMultiplier =
            1 +
            (
              Math.max(
                0,
                player.level - 1
              ) * 0.05
            );


          const pay =
            Math.floor(
              place.pay *
              type.pay *
              levelMultiplier
            );


          player.money +=
            pay;

          player.energy -=
            10;

          player.xp +=
            place.xp;


          let levelUp =
            false;


          const neededXp =
            player.level *
            100;


          if (
            player.xp >=
            neededXp
          ) {

            player.xp -=
              neededXp;

            player.level +=
              1;

            levelUp =
              true;
          }


          player.workCooldown =
            now + 2500;


          await savePlayer(
            player
          );


          sendMe(
            socket,
            player,

            levelUp
              ? `You worked as ${place.job} at ${place.name} and earned ₦${pay.toLocaleString()}. LEVEL UP!`
              : `You worked as ${place.job} at ${place.name} and earned ₦${pay.toLocaleString()}.`
          );
        }
      );


      /* =====================================================
         EAT
         ===================================================== */

      socket.on(
        'eat',
        async () => {

          if (
            player.riding !== null
          ) {
            return sendMe(
              socket,
              player,
              'Get off the bus first.'
            );
          }

          const COST =
            1500;

          if (
            player.money < COST
          ) {
            return sendMe(
              socket,
              player,
              'You need ₦1,500 to eat.'
            );
          }

          if (
            player.energy >= 100
          ) {
            return sendMe(
              socket,
              player,
              'Your energy is already full.'
            );
          }


          const place =
            nearest(player);

          if (!place) {
            return sendMe(
              socket,
              player,
              'Move near a place before eating.'
            );
          }


          player.money -=
            COST;

          player.energy =
            Math.min(
              100,
              player.energy + 40
            );


          await pool.query(
            `
            INSERT INTO money_transactions (
              player_id,
              amount,
              reason
            )
            VALUES ($1,$2,$3)
            `,
            [
              player.dbId,
              -COST,
              `Food at ${place.name}`
            ]
          );


          await savePlayer(
            player
          );


          sendMe(
            socket,
            player,
            `You ate at ${place.name}. Energy restored.`
          );
        }
      );


      /* =====================================================
         RIDE DANFO
         ===================================================== */

      socket.on(
        'ride',
        async () => {

          /* Get off */

          if (
            player.riding !== null
          ) {

            player.riding =
              null;

            sendMe(
              socket,
              player,
              'You got off the danfo.'
            );

            return;
          }


          let closestBus =
            null;

          let closestDistance =
            Infinity;


          for (
            const bus of buses
          ) {

            const distance =
              meters(
                player,
                bus
              );

            if (
              distance <
              closestDistance
            ) {

              closestDistance =
                distance;

              closestBus =
                bus;
            }
          }


          if (
            !closestBus ||
            closestDistance > 250
          ) {

            return sendMe(
              socket,
              player,
              'No danfo is close enough.'
            );
          }


          const fare =
            200;


          if (
            player.money < fare
          ) {

            return sendMe(
              socket,
              player,
              'You need ₦200 for the danfo.'
            );
          }


          player.money -=
            fare;

          player.riding =
            closestBus.id;


          await pool.query(
            `
            INSERT INTO money_transactions (
              player_id,
              amount,
              reason
            )
            VALUES ($1,$2,$3)
            `,
            [
              player.dbId,
              -fare,
              'Danfo fare'
            ]
          );


          await savePlayer(
            player
          );


          sendMe(
            socket,
            player,
            'You entered a danfo.'
          );
        }
      );


      /* =====================================================
         CHAT
         ===================================================== */

      socket.on(
        'chat',
        data => {

          const now =
            Date.now();

          if (
            now <
            player.chatCooldown
          ) {
            return;
          }

          const message =
            clean(
              data.message,
              140
            );

          if (!message) {
            return;
          }

          player.chatCooldown =
            now + 800;


          io.emit(
            'chat',
            {
              id:
                player.id,

              name:
                player.name,

              color:
                player.color,

              message
            }
          );
        }
      );


      /* =====================================================
         DISCONNECT
         ===================================================== */

      socket.on(
        'disconnect',
        async () => {

          try {

            await savePlayer(
              player
            );

          } catch (err) {

            console.error(
              'Disconnect save error:',
              err
            );
          }

          delete players[
            player.id
          ];
        }
      );

    } catch (err) {

      console.error(
        'Socket connection error:',
        err
      );

      socket.disconnect();
    }
  }
);


/* =========================================================
   WORLD LOOP
   ========================================================= */

setInterval(
  () => {

    const currentHour =
      hour();


    /* NPC movement */

    for (
      const npc of npcs
    ) {

      const working =
        currentHour >=
          7 &&
        currentHour < 18;


      const destination =
        working
          ? npc.work
          : npc.home;


      if (
        glide(
          npc,
          destination,
          8
        )
      ) {

        if (
          Math.random() <
          0.015
        ) {

          npc.off = [
            (Math.random() - 0.5) *
              0.0005,

            (Math.random() - 0.5) *
              0.0005
          ];
        }
      }
    }


    /* Bus movement */

    for (
      const bus of buses
    ) {

      if (
        bus.wait > 0
      ) {

        bus.wait -=
          0.5;

        continue;
      }


      const route =
        bus.route;

      const targetId =
        route[
          bus.stop
        ];

      const target =
        byId[targetId];


      if (!target) {
        continue;
      }


      const arrived =
        glide(
          bus,
          target,
          25
        );


      if (arrived) {

        bus.wait =
          4;

        bus.stop =
          (
            bus.stop + 1
          ) %
          route.length;
      }
    }


    io.emit(
      'world',
      {
        hour:
          currentHour,

        npcs:
          npcs.map(npc => ({
            lat:
              npc.lat +
              npc.off[0],

            lng:
              npc.lng +
              npc.off[1],

            r:
              npc.r
          })),

        buses:
          buses.map(bus => ({
            id:
              bus.id,

            lat:
              bus.lat,

            lng:
              bus.lng
          }))
      }
    );

  },
  500
);


/* =========================================================
   PLAYER STATE LOOP
   ========================================================= */

setInterval(
  () => {

    const state = [];


    for (
      const player of
      Object.values(players)
    ) {

      /* Player is riding a bus */

      if (
        player.riding !== null
      ) {

        const bus =
          buses.find(
            b =>
              b.id ===
              player.riding
          );

        if (bus) {

          player.lat =
            bus.lat;

          player.lng =
            bus.lng;

          player.targetLat =
            bus.lat;

          player.targetLng =
            bus.lng;
        }
      }


      /* Walking */

      else {

        glide(
          player,
          {
            lat:
              player.targetLat,

            lng:
              player.targetLng
          },
          8
        );
      }


      state.push({
        id:
          player.id,

        name:
          player.name,

        color:
          player.color,

        lat:
          player.lat,

        lng:
          player.lng,

        level:
          player.level,

        backgroundType:
          player.backgroundType ||
          null,

        backgroundNeighborhood:
          player.backgroundNeighborhood ||
          null
      });
    }


    io.emit(
      'state',
      state
    );

  },
  200
);


/* =========================================================
   ENERGY / SAVE LOOP
   ========================================================= */

setInterval(
  async () => {

    for (
      const player of
      Object.values(players)
    ) {

      if (
        player.energy < 100
      ) {

        player.energy =
          Math.min(
            100,
            player.energy + 1
          );
      }


      try {

        await savePlayer(
          player
        );

      } catch (err) {

        console.error(
          'Autosave error:',
          err
        );
      }


      const socket =
        [...io.sockets.sockets.values()]
          .find(
            s =>
              s.account &&
              s.account.id ===
              player.id
          );


      if (socket) {

        sendMe(
          socket,
          player
        );
      }
    }

  },
  5000
);


/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  '/health',
  (req, res) => {

    res.json({
      ok: true,

      game:
        'Ibadan Life',

      players:
        Object.keys(players).length,

      places:
        PLACES.length,

      npcs:
        npcs.length,

      buses:
        buses.length
    });
  }
);


/* =========================================================
   START SERVER
   ========================================================= */

initDatabase()
  .then(() => {

    srv.listen(
      PORT,
      () => {

        console.log(
          `Ibadan Life running on port ${PORT}`
        );

        console.log(
          `World locations: ${PLACES.length}`
        );

        console.log(
          `NPCs: ${npcs.length}`
        );

        console.log(
          `Danfo routes: ${buses.length}`
        );
      }
    );

  })
  .catch(err => {

    console.error(
      'Database initialization failed:',
      err
    );

    process.exit(1);
  });
