const path = require('path');
const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const monk = require('monk');
const csp = require('helmet-csp');
const bodyParser = require('body-parser');
const { nanoid } = require('nanoid');

const app = express();

app.use(bodyParser.json());

require('dotenv').config({ path: '.env' });

const db = monk(process.env.MONGODB_URI);

const investments = db.get('investments');

app.enable('trust proxy');

app.use(helmet());

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'unpkg.com',
        'cdn.jsdelivr.net',
        'fonts.googleapis.com',
        'use.fontawesome.com',
      ],
      scriptSrc: ["'self'", "'unsafe-eval'", 'cdnjs.cloudflare.com'],
      fontSrc: [
        "'self'", // Default policy for specifiying valid sources for fonts loaded using "@font-face": allow all content coming from origin (without subdomains).
        'https://fonts.gstatic.com',
        'https://cdnjs.cloudflare.com',
      ],
      styleSrc: [
        "'self'", // Default policy for valid sources for stylesheets: allow all content coming from origin (without subdomains).
        'https://fonts.googleapis.com',
        'https://cdnjs.cloudflare.com',
      ],
    },
  })
);

app.use(morgan('tiny'));
app.use(cors());
app.use(express.json());

let isLoggedIn = false;
let token;

app.get('/', async (req, res) => {
  res.send('it works!');
});

app.post('/auth', (req, res) => {
  const { username, password } = req.body;
  if (
    isLoggedIn &&
    token &&
    username === process.env.USERNAME &&
    password === process.env.PASSWORD
  ) {
    res.status(200).json({ token });
    return;
  }
  if (username === process.env.USERNAME && password === process.env.PASSWORD) {
    token = nanoid(30).toLowerCase();
    isLoggedIn = true;
    console.log('logged in with ', token);
    res.status(200).json({ token });
  } else {
    res.status(401).json({ error: 'Incorrect username or password' });
  }
});

app.post('/newRecord', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const obj = req.body;
    const created = await investments.insert(obj);
    if (obj._id) {
      delete obj._id;
    }
    if (created) {
      res.status(200).json({ ...obj, message: 'success' });
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
});

app.get('/allRecords', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const records = await investments.find();
    if (records) {
      records.forEach((element) => {
        if (element._id) {
          delete element._id;
        }
      });
      res.status(200).json({ ...records, message: 'success' });
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error.status) {
    res.status(error.status);
  } else res.status(500);
  res.json({
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack,
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log('Running on port ' + port);
});
