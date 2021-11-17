const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const monk = require('monk');
const bodyParser = require('body-parser');
const { nanoid } = require('nanoid');
const assets = require('./assets');

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
    return;
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

app.get('/records', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const raw = await investments.find();
    const [records, expenses] = buildAllData(raw);
    if (records) {
      res.status(200).json({ records, expenses, message: 'success' });
    }
  } catch (error) {
    next(error);
  }
});

app.get('/assets', (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    if (assets) {
      res.json(assets);
    }
  } catch (error) {
    next(error);
  }
});

app.get('/records/:asset', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const { asset } = req.params;
    const raw = await investments.find({ asset });
    const records = buildAssetsResponse(raw);
    // console.log(records);
    if (records) {
      res.status(200).json({ ...records, asset, message: 'success' });
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
});

app.get('/records-summary', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const raw = await investments.find();
    const { records, expenses, assets } = buildAllData(raw);
    const summary = assets.map((asset) => {
      const mostRecent = records
        .filter((record) => record.asset === asset)
        .reduce((a, b) => {
          return new Date(a.date) > new Date(b.date) ? a : b;
        });
      return {
        asset,
        lastInvested: mostRecent.formattedDate,
        date: mostRecent.date,
        expenses: expenses[mostRecent.asset.toLowerCase()],
      };
    });

    if (records) {
      res.status(200).json({
        records,
        summary,
        expenses,
        message: 'success',
      });
    }
  } catch (error) {
    next(error);
  }
});

app.get('/expenses/:asset', async (req, res, next) => {
  const authToken = req.headers.authorization;
  if (authToken !== token || !isLoggedIn) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const { asset } = req.params;
    const raw = await investments.find({ asset });
    const records = buildAssetsResponse(raw);
    if (records) {
      res.status(200).json({ ...records.total, asset, message: 'success' });
    }
  } catch (error) {
    console.log(error);
    next(error);
  }
});

const buildAssetsResponse = (data) => {
  let [array, expenses] = buildGenericResponse(data, true);
  let total = {};
  expenses.forEach((expense) => {
    let current = isNaN(parseFloat(total[expense.currency]))
      ? 0
      : parseFloat(total[expense.currency]);
    current += parseFloat(expense.value);
    total[expense.currency] = current;
  });
  console.log(total);
  return { records: array, total };
};

const buildGenericResponse = (data, buildExpenses) => {
  let array = [];
  let expenses = [];
  Object.keys(data).forEach((key) => {
    array.push({
      date: data[key].date,
      formattedDate: data[key].formattedDate,
      spendingDetails: data[key].spendingDetails,
      asset: data[key].asset,
      assetDetails: data[key].assetDetails,
    });
    if (buildExpenses) {
      expenses.push(...data[key].spendingDetails);
    }
  });

  return [array, expenses];
};

const buildAllData = (data) => {
  const [records] = buildGenericResponse(data);
  const { total, assets } = getExpensesFromAllData(records);
  return { records, expenses: total, assets };
};

const getExpensesFromAllData = (data) => {
  const uniqueAssets = [...new Set(data.map((item) => item.asset))];
  const total = {};
  uniqueAssets.forEach((asset) => {
    let expenses = [];
    let assetName = asset.toLowerCase();
    data.forEach((data) => {
      if (data.asset === asset) {
        expenses.push(...data.spendingDetails);
      }
    });
    expenses.forEach((expense) => {
      if (!total[assetName]) {
        total[assetName] = {};
      }
      let current = isNaN(parseFloat(total[assetName][expense.currency]))
        ? 0
        : parseFloat(total[assetName][expense.currency]);
      current += parseFloat(expense.value);
      total[assetName][expense.currency] = current;
    });
  });
  return { total, assets: uniqueAssets };
};

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
