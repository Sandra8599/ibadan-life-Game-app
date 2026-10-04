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

if (
  JWT_SECRET === 'CHANGE_THIS_SECRET_IN_RAILWAY'
) {
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

  /*
    These ALTER statements make the update safe for an
    existing PostgreSQL database created by the previous
    version of the game.
  */

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
    CREATE INDEX IF NOT EXISTS
    players_email_lower_idx
    ON players (LOWER(email))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,

      player_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      token_id TEXT UNIQUE NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,

      requester_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      receiver_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      status VARCHAR(20) NOT NULL DEFAULT 'pending',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE(requester_id, receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,

      sender_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      receiver_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      text TEXT NOT NULL,

      read_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_transactions (
      id BIGSERIAL PRIMARY KEY,

      sender_id BIGINT
        REFERENCES players(id)
        ON DELETE SET NULL,

      receiver_id BIGINT
        REFERENCES players(id)
        ON DELETE SET NULL,

      amount BIGINT NOT NULL,

      type VARCHAR(30) NOT NULL,

      note TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS money_requests (
      id BIGSERIAL PRIMARY KEY,

      requester_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      requested_from_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      amount BIGINT NOT NULL,

      note TEXT,

      status VARCHAR(20) NOT NULL DEFAULT 'pending',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,

      player_id BIGINT NOT NULL
        REFERENCES players(id)
        ON DELETE CASCADE,

      item_key VARCHAR(100) NOT NULL,

      quantity INTEGER NOT NULL DEFAULT 1,

      UNIQUE(player_id, item_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id BIGSERIAL PRIMARY KEY,

      owner_id BIGINT
        REFERENCES players(id)
        ON DELETE SET NULL,

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

      owner_id BIGINT
        REFERENCES players(id)
        ON DELETE SET NULL,

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
   HELPERS
========================================================= */

function clean(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,16}$/.test(username);
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
  return crypto.randomBytes(32).toString('hex');
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

async function getPlayerById(id) {
  const result = await pool.query(
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
      lng
    FROM players
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function authFromToken(token) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    return await getPlayerById(decoded.sub);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header =
    req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required.'
    });
  }

  authFromToken(header.slice(7))
    .then(player => {
      if (!player) {
        return res.status(401).json({
          error: 'Invalid or expired login.'
        });
      }

      req.player = player;
      next();
    })
    .catch(() => {
      res.status(500).json({
        error: 'Authentication error.'
      });
    });
}


/* =========================================================
   PUBLIC PLAYER
========================================================= */

function publicPlayer(player) {
  return {
    id: String(player.id),

    username: player.username,

    name: player.name,

    color: player.color,

    money: Number(player.money),

    energy: Number(player.energy),

    xp: Number(player.xp),

    level: Number(player.level),

    lat: player.lat,

    lng: player.lng
  };
}


/* =========================================================
   AUTH — SIGN UP
========================================================= */

app.post(
  '/api/auth/signup',
  async (req, res) => {
    try {
      const username = clean(
        req.body?.username,
        16
      );

      const password =
        req.body?.password;

      const confirmPassword =
        req.body?.confirmPassword;

      const email =
        clean(req.body?.email, 254)
          .toLowerCase();

      const color =
        validColor(req.body?.color)
          ? req.body.color
          : '#16a34a';

      if (!validUsername(username)) {
        return res.status(400).json({
          error:
            'Username must be 3-16 characters using letters, numbers, or _.'
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            'Password must be at least 6 characters.'
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          error:
            'Passwords do not match.'
        });
      }

      /*
        Email is optional for compatibility with
        accounts already created before the email
        recovery system was added.
      */

      if (
        email &&
        !validEmail(email)
      ) {
        return res.status(400).json({
          error:
            'Please enter a valid email address.'
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM players
          WHERE LOWER(username) = LOWER($1)
          `,
          [username]
        );

      if (existing.rowCount) {
        return res.status(409).json({
          error:
            'That username is already taken.'
        });
      }

      if (email) {
        const emailExists =
          await pool.query(
            `
            SELECT id
            FROM players
            WHERE LOWER(email) = LOWER($1)
            `,
            [email]
          );

        if (emailExists.rowCount) {
          return res.status(409).json({
            error:
              'That email is already connected to an account.'
          });
        }
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO players
          (
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
            lng
          )
          VALUES
          (
            $1,
            $2,
            NULLIF($3, ''),
            $4,
            $5,
            20000,
            100,
            0,
            1,
            $6,
            $7
          )
          RETURNING
            id,
            username,
            name,
            color,
            money,
            energy,
            xp,
            level,
            lat,
            lng
          `,
          [
            username,
            passwordHash,
            email,
            username,
            color,
            START.lat,
            START.lng
          ]
        );

      const player =
        result.rows[0];

      const token =
        createToken(player);

      res.json({
        token,
        player:
          publicPlayer(player)
      });
    } catch (err) {
      console.error(
        'Signup error:',
        err
      );

      res.status(500).json({
        error:
          'Could not create account.'
      });
    }
  }
);


/* =========================================================
   AUTH — LOGIN
========================================================= */

app.post(
  '/api/auth/login',
  async (req, res) => {
    try {
      const username =
        clean(
          req.body?.username,
          16
        );

      const password =
        req.body?.password;

      if (!username || !password) {
        return res.status(400).json({
          error:
            'Enter your username and password.'
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM players
          WHERE LOWER(username) = LOWER($1)
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
            'Incorrect username or password.'
        });
      }

      const correct =
        await bcrypt.compare(
          password,
          player.password_hash
        );

      if (!correct) {
        return res.status(401).json({
          error:
            'Incorrect username or password.'
        });
      }

      await pool.query(
        `
        UPDATE players
        SET updated_at = NOW()
        WHERE id = $1
        `,
        [player.id]
      );

      const token =
        createToken(player);

      res.json({
        token,
        player:
          publicPlayer(player)
      });
    } catch (err) {
      console.error(
        'Login error:',
        err
      );

      res.status(500).json({
        error:
          'Could not sign in.'
      });
    }
  }
);


/* =========================================================
   AUTH — CURRENT ACCOUNT
========================================================= */

app.get(
  '/api/auth/me',
  authMiddleware,
  async (req, res) => {
    res.json({
      player:
        publicPlayer(req.player)
    });
  }
);


/* =========================================================
   PASSWORD RECOVERY — REQUEST
========================================================= */

app.post(
  '/api/auth/forgot-password',
  async (req, res) => {
    try {
      const username =
        clean(
          req.body?.username,
          16
        );

      const email =
        clean(
          req.body?.email,
          254
        ).toLowerCase();

      /*
        We deliberately do not reveal whether
        an account exists.
      */

      if (!username && !email) {
        return res.json({
          message:
            'If the account can be recovered, recovery instructions will be provided.'
        });
      }

      let result;

      if (email) {
        result =
          await pool.query(
            `
            SELECT id, username, email
            FROM players
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [email]
          );
      } else {
        result =
          await pool.query(
            `
            SELECT id, username, email
            FROM players
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username]
          );
      }

      if (!result.rowCount) {
        return res.json({
          message:
            'If the account can be recovered, recovery instructions will be provided.'
        });
      }

      const player =
        result.rows[0];

      /*
        No email service is assumed here.
        We generate a secure one-time recovery token
        and store only its hash.

        The token itself is never stored in PostgreSQL.
      */

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
            NOW() + INTERVAL '30 minutes',
          updated_at = NOW()
        WHERE id = $2
        `,
        [
          tokenHash,
          player.id
        ]
      );

      /*
        If an email provider is configured later,
        this token can be sent by email.

        For now it is intentionally NOT returned
        as a public password-reset credential.
      */

      console.log(
        `Password recovery requested for account ${player.username}.`
      );

      res.json({
        message:
          'If the account can be recovered, recovery instructions will be provided.'
      });
    } catch (err) {
      console.error(
        'Forgot password error:',
        err
      );

      res.status(500).json({
        error:
          'Password recovery could not be started.'
      });
    }
  }
);


/* =========================================================
   PASSWORD RECOVERY — RESET
========================================================= */

app.post(
  '/api/auth/reset-password',
  async (req, res) => {
    try {
      const token =
        clean(
          req.body?.token,
          200
        );

      const password =
        req.body?.password;

      const confirmPassword =
        req.body?.confirmPassword;

      if (!token) {
        return res.status(400).json({
          error:
            'Recovery token is missing.'
        });
      }

      if (!validPassword(password)) {
        return res.status(400).json({
          error:
            'Password must be at least 6 characters.'
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          error:
            'Passwords do not match.'
        });
      }

      const tokenHash =
        hashRecoveryToken(token);

      const result =
        await pool.query(
          `
          SELECT *
          FROM players
          WHERE recovery_token_hash = $1
            AND recovery_expires_at > NOW()
          LIMIT 1
          `,
          [tokenHash]
        );

      if (!result.rowCount) {
        return res.status(400).json({
          error:
            'This recovery link is invalid or expired.'
        });
      }

      const player =
        result.rows[0];

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
          player.id
        ]
      );

      res.json({
        message:
          'Password changed successfully.'
      });
    } catch (err) {
      console.error(
        'Reset password error:',
        err
      );

      res.status(500).json({
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
      if (
        !googleClient ||
        !process.env.GOOGLE_CLIENT_ID
      ) {
        return res.status(503).json({
          error:
            'Google login is not configured yet.'
        });
      }

      const credential =
        req.body?.credential;

      if (!credential) {
        return res.status(400).json({
          error:
            'Google credential missing.'
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

      if (
        !payload ||
        !payload.sub ||
        !payload.email
      ) {
        return res.status(401).json({
          error:
            'Invalid Google account.'
        });
      }

      const googleId =
        payload.sub;

      const email =
        String(payload.email)
          .toLowerCase();

      let result =
        await pool.query(
          `
          SELECT *
          FROM players
          WHERE google_id = $1
          `,
          [googleId]
        );

      let player =
        result.rows[0];

      if (!player) {
        /*
          If this Google email already belongs
          to a normal account, connect Google to
          that account instead of creating a duplicate.
        */

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
        }
      }

      if (!player) {
        const rawBase =
          payload.name ||
          email.split('@')[0] ||
          'Player';

        const base =
          clean(
            rawBase
              .replace(
                /[^A-Za-z0-9_]/g,
                ''
              ),
            12
          ) || 'Player';

        let username =
          base;

        let number = 1;

        while (true) {
          const check =
            await pool.query(
              `
              SELECT id
              FROM players
              WHERE LOWER(username) =
                    LOWER($1)
              `,
              [username]
            );

          if (!check.rowCount) {
            break;
          }

          username =
            `${base.slice(
              0,
              14
            )}${number}`;

          number++;
        }

        result =
          await pool.query(
            `
            INSERT INTO players
            (
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
              lng
            )
            VALUES
            (
              $1,
              $2,
              $3,
              $4,
              '#16a34a',
              20000,
              100,
              0,
              1,
              $5,
              $6
            )
            RETURNING *
            `,
            [
              username,
              googleId,
              email,
              clean(
                payload.name ||
                  username,
                16
              ),
              START.lat,
              START.lng
            ]
          );

        player =
          result.rows[0];
      }

      const token =
        createToken(player);

      res.json({
        token,
        player:
          publicPlayer(player)
      });
    } catch (err) {
      console.error(
        'Google login error:',
        err
      );

      res.status(401).json({
        error:
          'Google sign-in could not be completed.'
      });
    }
  }
);


/* =========================================================
   GAME WORLD
========================================================= */

const TYPES = {
  wealthy: {
    pay: 1.5,
    npc: 3
  },

  middle: {
    pay: 1.2,
    npc: 4
  },

  ordinary: {
    pay: 1,
    npc: 5
  },

  commercial: {
    pay: 1.1,
    npc: 10
  },

  older: {
    pay: 0.9,
    npc: 6
  }
};

const PLACES = [
  {
    id: 'mokola',
    name: 'Mokola',
    type: 'middle',
    lat: 7.4040,
    lng: 3.8990,
    job: 'Bus conductor',
    pay: 2500,
    xp: 6
  },

  {
    id: 'dugbe',
    name: 'Dugbe Market',
    type: 'commercial',
    lat: 7.3890,
    lng: 3.8830,
    job: 'Market trader',
    pay: 3000,
    xp: 7
  },

  {
    id: 'bodija',
    name: 'Bodija',
    type: 'wealthy',
    lat: 7.4300,
    lng: 3.9100,
    job: 'Provisions seller',
    pay: 3500,
    xp: 8
  },

  {
    id: 'ui',
    name: 'University of Ibadan',
    type: 'middle',
    lat: 7.4443,
    lng: 3.9000,
    job: 'Campus tutor',
    pay: 4500,
    xp: 12
  },

  {
    id: 'ringroad',
    name: 'Ring Road',
    type: 'commercial',
    lat: 7.3620,
    lng: 3.8760,
    job: 'Okada rider',
    pay: 3200,
    xp: 8
  },

  {
    id: 'challenge',
    name: 'Challenge',
    type: 'commercial',
    lat: 7.3470,
    lng: 3.8780,
    job: 'Mechanic helper',
    pay: 3800,
    xp: 9
  },

  {
    id: 'jericho',
    name: 'Jericho',
    type: 'wealthy',
    lat: 7.4150,
    lng: 3.8950,
    job: 'Restaurant waiter',
    pay: 3000,
    xp: 7
  },

  {
    id: 'iwo',
    name: 'Iwo Road',
    type: 'commercial',
    lat: 7.3930,
    lng: 3.9420,
    job: 'Dispatch rider',
    pay: 3600,
    xp: 9
  },

  {
    id: 'apata',
    name: 'Apata',
    type: 'ordinary',
    lat: 7.3500,
    lng: 3.8550,
    job: 'Brick layer',
    pay: 4000,
    xp: 10
  },

  {
    id: 'akobo',
    name: 'Akobo',
    type: 'ordinary',
    lat: 7.4350,
    lng: 3.9650,
    job: 'Shop attendant',
    pay: 3300,
    xp: 8
  },

  {
    id: 'sango',
    name: 'Sango',
    type: 'middle',
    lat: 7.4220,
    lng: 3.9200,
    job: 'Tailor assistant',
    pay: 3400,
    xp: 8
  },

  {
    id: 'mapo',
    name: 'Mapo Hall',
    type: 'older',
    lat: 7.3880,
    lng: 3.8960,
    job: 'Tour guide',
    pay: 3700,
    xp: 9
  },

  {
    id: 'okeado',
    name: 'Oke-Ado',
    type: 'older',
    lat: 7.3800,
    lng: 3.8900,
    job: 'Bakery helper',
    pay: 2800,
    xp: 6
  },

  {
    id: 'oluyole',
    name: 'Oluyole',
    type: 'wealthy',
    lat: 7.3560,
    lng: 3.8800,
    job: 'Security guard',
    pay: 4200,
    xp: 10
  },

  {
    id: 'agodi',
    name: 'Agodi',
    type: 'middle',
    lat: 7.4000,
    lng: 3.9080,
    job: 'Hospital porter',
    pay: 3600,
    xp: 9
  },

  {
    id: 'bashorun',
    name: 'Bashorun',
    type: 'wealthy',
    lat: 7.4180,
    lng: 3.9380,
    job: 'Estate caretaker',
    pay: 3900,
    xp: 9
  },

  {
    id: 'odoona',
    name: 'Odo-Ona',
    type: 'older',
    lat: 7.3640,
    lng: 3.8530,
    job: 'Welder helper',
    pay: 3100,
    xp: 8
  },

  {
    id: 'newgarage',
    name: 'New Garage',
    type: 'commercial',
    lat: 7.3590,
    lng: 3.9130,
    job: 'Park loader',
    pay: 3300,
    xp: 8
  },

  {
    id: 'eleyele',
    name: 'Eleyele',
    type: 'ordinary',
    lat: 7.4160,
    lng: 3.8550,
    job: 'Fish seller',
    pay: 2900,
    xp: 7
  },

  {
    id: 'monatan',
    name: 'Monatan',
    type: 'ordinary',
    lat: 7.4080,
    lng: 3.8440,
    job: 'Delivery rider',
    pay: 3200,
    xp: 8
  },

  {
    id: 'omiadio',
    name: 'Omi-Adio',
    type: 'ordinary',
    lat: 7.3760,
    lng: 3.8150,
    job: 'Farm hand',
    pay: 3000,
    xp: 8
  }
];

const START = PLACES[0];

const byId =
  Object.fromEntries(
    PLACES.map(p => [
      p.id,
      p
    ])
  );

const meters = (a, b) =>
  Math.hypot(
    (a.lat - b.lat) * 111000,

    (a.lng - b.lng) *
      111000 *
      Math.cos(
        a.lat *
        Math.PI /
        180
      )
  );

const nearest = p =>
  PLACES.find(
    place =>
      meters(p, place) < 200
  );

const hour = () =>
  (Date.now() / 60000) % 24;

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
  for (
    let k = 0;
    k < TYPES[home.type].npc;
    k++
  ) {
    const work =
      Math.random() < 0.6
        ? home
        : PLACES[
            Math.floor(
              Math.random() *
              PLACES.length
            )
          ];

    npcs.push({
      home,

      work,

      r:
        ROLES[
          Math.floor(
            Math.random() *
            ROLES.length
          )
        ],

      lat: home.lat,

      lng: home.lng,

      off: [0, 0],

      shift:
        6 +
        Math.random() * 2
    });
  }
});

const ROUTES = [
  [
    'mokola',
    'dugbe',
    'okeado',
    'mapo',
    'ringroad',
    'challenge',
    'oluyole',
    'apata',
    'odoona'
  ],

  [
    'ui',
    'bodija',
    'sango',
    'bashorun',
    'akobo',
    'iwo',
    'newgarage',
    'agodi'
  ],

  [
    'jericho',
    'eleyele',
    'monatan',
    'omiadio',
    'mokola',
    'agodi',
    'dugbe'
  ],

  [
    'dugbe',
    'ringroad',
    'newgarage',
    'iwo',
    'bashorun',
    'bodija',
    'ui',
    'jericho'
  ]
];

const buses =
  ROUTES.map(
    (route, index) => ({
      id: index,

      route,

      stop: 0,

      wait: 0,

      lat:
        byId[route[0]].lat,

      lng:
        byId[route[0]].lng
    })
  );

function glide(
  object,
  target,
  step
) {
  const distance =
    meters(
      object,
      target
    );

  if (distance <= step) {
    object.lat =
      target.lat;

    object.lng =
      target.lng;

    return true;
  }

  const factor =
    step / distance;

  object.lat +=
    (target.lat -
      object.lat) *
    factor;

  object.lng +=
    (target.lng -
      object.lng) *
    factor;

  return false;
}


/* =========================================================
   ACTIVE PLAYERS
========================================================= */

const players = {};

async function savePlayer(player) {
  if (
    !player ||
    !player.accountId
  ) {
    return;
  }

  try {
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

        Math.round(
          player.money
        ),

        Math.round(
          player.energy
        ),

        Math.round(
          player.xp
        ),

        Math.round(
          player.level
        ),

        player.lat,

        player.lng,

        player.accountId
      ]
    );
  } catch (err) {
    console.error(
      'Save player error:',
      err
    );
  }
}

async function sendMe(
  socketId,
  note
) {
  const player =
    players[socketId];

  if (!player) return;

  io.to(socketId).emit(
    'me',
    {
      money:
        Math.round(
          player.money
        ),

      energy:
        Math.round(
          player.energy
        ),

      level:
        player.level,

      xp:
        player.xp,

      need:
        player.level * 50,

      riding:
        player.bus !== null &&
        player.bus !== undefined,

      note
    }
  );
}


/* =========================================================
   WORLD LOOP
========================================================= */

setInterval(() => {
  const currentHour =
    hour();

  for (const npc of npcs) {
    const atWork =
      currentHour >=
        npc.shift &&
      currentHour < 17;

    const base =
      atWork
        ? npc.work
        : npc.home;

    if (
      Math.random() <
      0.05
    ) {
      npc.off = [
        (Math.random() -
          0.5) *
          0.002,

        (Math.random() -
          0.5) *
          0.002
      ];
    }

    const night =
      currentHour >= 21 ||
      currentHour < 5;

    glide(
      npc,
      {
        lat:
          base.lat +
          npc.off[0] *
            (night
              ? 0.3
              : 1),

        lng:
          base.lng +
          npc.off[1] *
            (night
              ? 0.3
              : 1)
      },
      40
    );
  }

  for (const bus of buses) {
    if (bus.wait > 0) {
      bus.wait--;
      continue;
    }

    const stop =
      byId[
        bus.route[
          bus.stop
        ]
      ];

    if (
      glide(
        bus,
        stop,
        70
      )
    ) {
      bus.stop =
        (bus.stop + 1) %
        bus.route.length;

      bus.wait = 6;
    }
  }

  const round5 =
    value =>
      Math.round(
        value * 100000
      ) / 100000;

  io.emit(
    'world',
    {
      h:
        currentHour,

      npcs:
        npcs.map(npc => [
          round5(npc.lat),
          round5(npc.lng),
          npc.r
        ]),

      buses:
        buses.map(bus => [
          bus.id,
          round5(bus.lat),
          round5(bus.lng)
        ])
    }
  );
}, 500);


/* =========================================================
   SOCKET AUTHENTICATION
========================================================= */

io.use(
  async (
    socket,
    next
  ) => {
    try {
      const token =
        socket.handshake
          .auth?.token;

      if (!token) {
        return next(
          new Error(
            'Login required.'
          )
        );
      }

      const account =
        await authFromToken(
          token
        );

      if (!account) {
        return next(
          new Error(
            'Invalid login.'
          )
        );
      }

      socket.account =
        account;

      next();
    } catch {
      next(
        new Error(
          'Authentication failed.'
        )
      );
    }
  }
);


/* =========================================================
   GAME SOCKET
========================================================= */

io.on(
  'connection',
  async socket => {
    const account =
      socket.account;

    let lat =
      account.lat;

    let lng =
      account.lng;

    if (
      !Number.isFinite(lat)
    ) {
      lat =
        START.lat;
    }

    if (
      !Number.isFinite(lng)
    ) {
      lng =
        START.lng;
    }

    players[socket.id] = {
      socketId:
        socket.id,

      accountId:
        Number(account.id),

      name:
        clean(
          account.name,
          16
        ) ||
        'Player',

      username:
        account.username,

      color:
        validColor(
          account.color
        )
          ? account.color
          : '#16a34a',

      lat,

      lng,

      target: null,

      money:
        Number(account.money),

      energy:
        Number(account.energy),

      xp:
        Number(account.xp),

      level:
        Number(account.level),

      lastWork: 0,

      lastChat: 0,

      bus: null
    };

    const player =
      players[socket.id];

    socket.emit(
      'places',
      PLACES
    );

    await sendMe(
      socket.id,
      `Welcome back to Ibadan, ${player.name}!`
    );


    /* -----------------------------------------------------
       MOVE
    ----------------------------------------------------- */

    socket.on(
      'moveTo',
      target => {
        if (
          !player ||
          player.bus !== null &&
          player.bus !== undefined
        ) {
          return;
        }

        if (
          !target ||
          !Number.isFinite(
            Number(target.lat)
          ) ||
          !Number.isFinite(
            Number(target.lng)
          )
        ) {
          return;
        }

        player.target = {
          lat:
            Number(target.lat),

          lng:
            Number(target.lng)
        };
      }
    );


    /* -----------------------------------------------------
       WORK
    ----------------------------------------------------- */

    socket.on(
      'work',
      async () => {
        if (!player) return;

        const place =
          nearest(player);

        if (!place) {
          return sendMe(
            player.socketId,
            'Walk to a location marker to work.'
          );
        }

        if (
          Date.now() -
            player.lastWork <
          2500
        ) {
          return;
        }

        if (
          player.energy < 10
        ) {
          return sendMe(
            player.socketId,
            'Too tired. Eat something or wait.'
          );
        }

        player.lastWork =
          Date.now();

        player.energy -= 10;

        const pay =
          Math.round(
            place.pay *
              TYPES[
                place.type
              ].pay *
              (
                1 +
                (player.level -
                  1) *
                  0.08
              )
          );

        player.money +=
          pay;

        player.xp +=
          place.xp;

        while (
          player.xp >=
          player.level *
            50
        ) {
          player.xp -=
            player.level *
            50;

          player.level++;
        }

        await savePlayer(
          player
        );

        sendMe(
          player.socketId,
          `${place.job} at ${place.name}: +₦${pay.toLocaleString()}`
        );
      }
    );


    /* -----------------------------------------------------
       EAT
    ----------------------------------------------------- */

    socket.on(
      'eat',
      async () => {
        if (!player) return;

        const place =
          nearest(player);

        if (!place) {
          return sendMe(
            player.socketId,
            'Walk to a location to buy food.'
          );
        }

        if (
          player.money < 1500
        ) {
          return sendMe(
            player.socketId,
            'Not enough money.'
          );
        }

        player.money -=
          1500;

        player.energy =
          Math.min(
            100,
            player.energy +
              40
          );

        await savePlayer(
          player
        );

        sendMe(
          player.socketId,
          `Ate amala at ${place.name}: -₦1,500, +40 energy`
        );
      }
    );


    /* -----------------------------------------------------
       RIDE
    ----------------------------------------------------- */

    socket.on(
      'ride',
      async () => {
        if (!player) return;

        if (
          player.bus !== null
        ) {
          player.bus =
            null;

          await savePlayer(
            player
          );

          return sendMe(
            player.socketId,
            'You got off the danfo.'
          );
        }

        const bus =
          buses.find(
            currentBus =>
              meters(
                player,
                currentBus
              ) < 250
          );

        if (!bus) {
          return sendMe(
            player.socketId,
            'No danfo nearby. Wait at a marker.'
          );
        }

        if (
          player.money < 200
        ) {
          return sendMe(
            player.socketId,
            'Fare is ₦200. Not enough money.'
          );
        }

        player.money -=
          200;

        player.bus =
          bus.id;

        player.target =
          null;

        await savePlayer(
          player
        );

        sendMe(
          player.socketId,
          'You boarded the danfo (-₦200). Tap Get off to leave.'
        );
      }
    );


    /* -----------------------------------------------------
       CHAT
    ----------------------------------------------------- */

    socket.on(
      'chat',
      message => {
        if (!player) return;

        const text =
          clean(
            message,
            140
          );

        if (
          !text ||
          Date.now() -
            player.lastChat <
            800
        ) {
          return;
        }

        player.lastChat =
          Date.now();

        io.emit(
          'chat',
          {
            name:
              player.name,

            text
          }
        );
      }
    );


    /* -----------------------------------------------------
       DISCONNECT
    ----------------------------------------------------- */

    socket.on(
      'disconnect',
      async () => {
        const leaving =
          players[
            socket.id
          ];

        if (leaving) {
          await savePlayer(
            leaving
          );

          delete players[
            socket.id
          ];
        }

        io.emit(
          'left',
          socket.id
        );
      }
    );
  }
);


/* =========================================================
   ACTIVE PLAYER STATE
========================================================= */

setInterval(
  async () => {
    const list = [];

    for (
      const player of
      Object.values(players)
    ) {
      if (
        player.bus !== null &&
        player.bus !== undefined
      ) {
        const bus =
          buses[
            player.bus
          ];

        if (bus) {
          player.lat =
            bus.lat;

          player.lng =
            bus.lng;
        }
      } else if (
        player.target
      ) {
        const distance =
          meters(
            player,
            player.target
          );

        const step = 8;

        if (
          distance <= step
        ) {
          player.lat =
            player.target.lat;

          player.lng =
            player.target.lng;

          player.target =
            null;
        } else {
          const factor =
            step / distance;

          player.lat +=
            (
              player.target.lat -
              player.lat
            ) *
            factor;

          player.lng +=
            (
              player.target.lng -
              player.lng
            ) *
            factor;
        }
      }

      list.push({
        id:
          String(
            player.accountId
          ),

        name:
          player.name,

        color:
          player.color,

        lat:
          player.lat,

        lng:
          player.lng,

        level:
          player.level
      });
    }

    io.emit(
      'state',
      list
    );
  },
  200
);


/* =========================================================
   ENERGY + PERIODIC SAVE
========================================================= */

setInterval(
  async () => {
    for (
      const player of
      Object.values(players)
    ) {
      player.energy =
        Math.min(
          100,
          player.energy + 1
        );

      sendMe(
        player.socketId
      );

      await savePlayer(
        player
      );
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
    res.send('ok');
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
