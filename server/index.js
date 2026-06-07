require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { seedIfEmpty } = require('./db/seed');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/phases', require('./routes/phases'));
app.use('/api/shoes', require('./routes/shoes'));
app.use('/api/export', require('./routes/export'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/import', require('./routes/import'));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

seedIfEmpty();

app.listen(PORT, () => {
  console.log(`\n🏃 Suunto Run Tracker running at http://localhost:${PORT}\n`);
});
