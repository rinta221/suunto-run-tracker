const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

router.get('/', (req, res) => {
  const shoes = db.prepare('SELECT * FROM shoes ORDER BY is_active DESC, name ASC').all();
  // Recalculate total_km from sessions
  for (const s of shoes) {
    const r = db.prepare('SELECT COALESCE(SUM(distance_km),0) as total FROM sessions WHERE shoes = ?').get(s.name);
    s.total_km = Math.round(r.total * 10) / 10;
  }
  res.json(shoes);
});

router.post('/', (req, res) => {
  const id = uuidv4();
  const { name, purchase_date, notes } = req.body;
  db.prepare('INSERT INTO shoes (id, name, purchase_date, total_km, is_active, notes) VALUES (?,?,?,0,1,?)')
    .run(id, name, purchase_date || null, notes || null);
  res.status(201).json(db.prepare('SELECT * FROM shoes WHERE id = ?').get(id));
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { name, purchase_date, is_active, notes } = req.body;
  db.prepare('UPDATE shoes SET name=?, purchase_date=?, is_active=?, notes=? WHERE id=?')
    .run(name, purchase_date || null, is_active !== undefined ? is_active : 1, notes || null, id);
  res.json(db.prepare('SELECT * FROM shoes WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM shoes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
