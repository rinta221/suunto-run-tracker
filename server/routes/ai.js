const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const lapsStore = require('../laps-store');

const DUMMY_CLAUDE = [
  '【ダミー評価】心拍データと距離の比率から、有酸素ベースが着実に向上しています。接地時間250ms台はやや改善余地あり。ケイデンスを180spm以上に保つことで、より効率的なランニングフォームが実現できます。感想と客観データに乖離はなく、自己認識精度が高いです。',
  '【ダミー評価】ペースと心拍の相関が安定しており、トレーニング負荷のコントロールが良好です。上下動8cm台はエネルギーロスの観点からやや高め。体幹強化で改善できる可能性があります。ラップデータを見ると後半のペース維持が課題です。',
  '【ダミー評価】TRIMP値がウィークリー目標に対して適切な負荷になっています。左右バランスは50%に近く、故障リスクは低い状態です。VO2maxの緩やかな上昇傾向が見られ、フィットネス向上が数値に現れています。',
];

const DUMMY_GPT = [
  '【ダミー評価】よく頑張りました！感想から練習に真摯に取り組んでいることが伝わります。今日のポイントはしっかり押さえられています。次回は少しだけケイデンスを意識してみましょう。継続こそが最大の才能です！',
  '【ダミー評価】素晴らしいランでしたね！データを見るとしっかりと体が反応しています。感想に書かれた気づきはとても重要で、それを意識できているあなたは着実に成長しています。次のトレーニングも楽しみですね！',
  '【ダミー評価】今日も走り切りましたね！数字も気持ちも両方大切にしながら練習できているのが伝わります。身体の声に耳を傾けながら、無理なく続けていきましょう。応援しています！',
];

// POST /api/ai/evaluate
// Body: { sessionId, provider: 'claude' | 'gpt' }
// Phase 1.5: 評価の読み書き・ロックガードを evaluations テーブルに切替（sessionId = slot id）
// Attaches lap data from in-memory store (not persisted in DB per design spec)
router.post('/evaluate', (req, res) => {
  const { sessionId, provider } = req.body;
  if (!sessionId || !provider) return res.status(400).json({ error: 'sessionId and provider required' });

  const slot = db.prepare('SELECT id FROM slots WHERE id = ?').get(sessionId);
  if (!slot) return res.status(404).json({ error: 'Session not found' });

  const ai = provider === 'claude' ? 'claude' : 'gpt';
  const existing = db.prepare('SELECT id, locked FROM evaluations WHERE slot_id = ? AND ai = ?').get(sessionId, ai);
  if (existing && existing.locked) {
    return res.status(403).json({
      error: provider === 'claude' ? 'Claude評価はロックされています' : 'GPT評価はロックされています',
    });
  }

  const laps = lapsStore.getLaps(sessionId);
  const lapCount = laps ? laps.length : 0;

  // Simulate AI processing delay (Phase 1 — dummy response)
  setTimeout(() => {
    const now = new Date().toISOString();
    const dummies = provider === 'claude' ? DUMMY_CLAUDE : DUMMY_GPT;
    let text = dummies[Math.floor(Math.random() * dummies.length)];

    // Mention lap count if laps are available
    if (lapCount > 0) {
      text += ` （${lapCount}ラップのデータを参照しました）`;
    }

    if (existing) {
      db.prepare('UPDATE evaluations SET text = ?, created_at = ?, updated_at = ? WHERE id = ?')
        .run(text, now, now, existing.id);
    } else {
      db.prepare('INSERT INTO evaluations (id, slot_id, ai, text, locked, created_at, updated_at) VALUES (?,?,?,?,0,?,?)')
        .run(uuidv4(), sessionId, ai, text, now, now);
    }
    db.prepare('UPDATE slots SET updated_at = ? WHERE id = ?').run(now, sessionId);

    res.json({ text, evaluatedAt: now, lapCount });
  }, 1500);
});

// GET /api/ai/settings
router.get('/settings', (req, res) => {
  res.json({
    anthropicKeySet: !!(process.env.ANTHROPIC_API_KEY),
    openaiKeySet: !!(process.env.OPENAI_API_KEY),
    phase: 1,
    note: 'Phase 1: AI評価はダミーレスポンスです。Phase 2でAPIキー設定後に実際のClaude/GPT評価が使えます。',
  });
});

module.exports = router;
