const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM phases ORDER BY start_date ASC').all());
});

router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const id = uuidv4();
  const { name, start_date, end_date, color, notes } = req.body;
  db.prepare('INSERT INTO phases (id, name, start_date, end_date, color, notes, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, start_date, end_date || null, color || '#3B82F6', notes || null, now);
  res.status(201).json(db.prepare('SELECT * FROM phases WHERE id = ?').get(id));
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { name, start_date, end_date, color, notes } = req.body;
  db.prepare('UPDATE phases SET name=?, start_date=?, end_date=?, color=?, notes=? WHERE id=?')
    .run(name, start_date, end_date || null, color, notes || null, id);
  res.json(db.prepare('SELECT * FROM phases WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE sessions SET phase_id = NULL WHERE phase_id = ?').run(req.params.id);
  db.prepare('DELETE FROM phases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
