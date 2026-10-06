require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const requestRoutes = require('./routes/requestRoutes');
const messageRoutes = require('./routes/messageRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { logError, requestLogger } = require('./middleware/requestLogger');

const app = express();
const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  clearExpired: false,
  expiration: 7 * 24 * 60 * 60 * 1000
}, db);
sessionStore.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] ERROR session-store ${error.code || error.message}`);
});
const port = Number(process.env.PORT || 3000);
const sessionCleanupTimer = setInterval(() => {
  sessionStore.clearExpiredSessions().catch((error) => {
    console.error('Session cleanup skipped:', error.code || error.message);
  });
}, 15 * 60 * 1000);
sessionCleanupTimer.unref();

app.disable('x-powered-by');
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in Backend/.env');
}

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

if (allowedOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin && req.headers.origin.replace(/\/+$/, '');
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}

app.use(requestLogger());
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'campusshare.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use(express.static(path.resolve(__dirname, '../Frontend')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Each image must be 5 MB or smaller.' });
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE' || error.message?.startsWith('Upload ')) {
    return res.status(400).json({ error: error.message || 'Unexpected image upload.' });
  }
  if (error.publicMessage) return res.status(error.statusCode || 502).json({ error: error.publicMessage });
  logError(req, error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(port, () => {
  const mailer = require('./config/mailer');
  const storageReady = require('./config/cloudinary').isConfigured();
  console.log(`[${new Date().toISOString()}] INFO CampusShare listening on http://0.0.0.0:${port} env=${process.env.NODE_ENV || 'development'}`);
  console.log(`[${new Date().toISOString()}] INFO services mail=${mailer.isConfigured() ? mailer.describe() : 'disabled'} cloudinary=${storageReady ? 'configured' : 'disabled'} db=${process.env.DB_HOST || 'unset'}`);
});