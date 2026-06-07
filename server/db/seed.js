const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const lapsStore = require('../laps-store');

function trimp(durationMin, hr) {
  // Simplified Banister TRIMP (hr in BPM, assumed max 185)
  const r = Math.min(hr / 185, 1);
  return Math.round(durationMin * r * 0.64 * Math.exp(1.92 * r));
}

function mkSession(date, type, opts = {}) {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    activity_type: type,
    suunto_workout_id: type === 'running' ? `SWO-${Math.random().toString(36).slice(2, 10)}` : null,
    phase_id: null,
    date,
    menu: opts.menu || null,
    memo: opts.memo || null,
    locate: opts.locate || null,
    shoes: opts.shoes || null,
    distance_km: opts.distance || null,
    duration_s: opts.duration || null,
    pace_per_km_s: opts.distance && opts.duration ? Math.round(opts.duration / opts.distance) : null,
    avg_hr_pct: opts.hr || null,
    elevation_m: opts.elev || null,
    cadence_score: opts.cs || null,
    energy_kcal: opts.distance ? Math.round(opts.distance * 65) : null,
    title: opts.title || null,
    trimp: opts.distance && opts.duration && opts.hr
      ? trimp(Math.round(opts.duration / 60), opts.hr) : null,
    vo2max: opts.vo2max || null,
    ground_contact_ms: opts.gc || null,
    gcb_left_pct: opts.gcb || null,
    vertical_oscillation_cm: opts.vo || null,
    cadence_max_spm: opts.cadMax || null,
    cadence_avg_spm: opts.cadAvg || null,
    stride_length_cm: opts.stride || null,
    gc_balance: opts.gcBalance || null,
    impression: opts.impression || null,
    claude_eval: null, claude_eval_at: null, gpt_eval: null, gpt_eval_at: null,
    created_at: now, updated_at: now,
  };
}

function loadSampleSessions() {
  const filePath = path.join(__dirname, '../../data/sample_sessions.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const now = new Date().toISOString();
  return raw.map(s => {
    // Extract laps and store separately (NOT in DB)
    const { laps, max_hr_pct, ...sessionData } = s;
    if (laps && laps.length) lapsStore.setLaps(s.id, laps);

    return {
      id: s.id,
      activity_type: s.activity_type || 'running',
      suunto_workout_id: s.suunto_workout_id || null,
      phase_id: null,
      date: s.date,
      menu: s.menu || null,
      memo: s.memo || null,
      locate: s.locate || null,
      shoes: s.shoes || null,
      distance_km: s.distance_km || null,
      duration_s: s.duration_s || null,
      pace_per_km_s: s.pace_per_km_s || null,
      avg_hr_pct: s.avg_hr_pct || null,
      elevation_m: s.elevation_m || null,
      cadence_score: s.cadence_score || null,
      energy_kcal: s.energy_kcal || null,
      title: s.title || null,
      trimp: s.trimp || null,
      vo2max: s.vo2max || null,
      ground_contact_ms: s.ground_contact_ms || null,
      gcb_left_pct: s.gcb_left_pct || null,
      vertical_oscillation_cm: s.vertical_oscillation_cm || null,
      cadence_max_spm: s.cadence_max_spm || null,
      cadence_avg_spm: s.cadence_avg_spm || null,
      stride_length_cm: s.stride_length_cm || null,
      gc_balance: s.gc_balance || null,
      impression: s.impression || null,
      claude_eval: s.claude_eval || null,
      claude_eval_at: s.claude_eval_at || null,
      gpt_eval: s.gpt_eval || null,
      gpt_eval_at: s.gpt_eval_at || null,
      created_at: s.created_at || now,
      updated_at: s.updated_at || now,
    };
  });
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
  if (count > 0) {
    // Re-load laps into memory store even if DB already has data
    reloadLapsStore();
    return;
  }

  const now = new Date().toISOString();

  // --- Shoes ---
  const shoes = [
    { id: uuidv4(), name: 'neo zen', purchase_date: '2025-09-01', total_km: 0, is_active: 1, notes: '軽量・デイリートレーナー' },
    { id: uuidv4(), name: 'SUPERBLAST 2', purchase_date: '2025-11-01', total_km: 0, is_active: 1, notes: 'ロング・ペース走' },
    { id: uuidv4(), name: 'SPEED 4', purchase_date: '2025-10-01', total_km: 0, is_active: 1, notes: 'スピード練習・レース' },
    { id: uuidv4(), name: 'WR28', purchase_date: '2025-06-01', total_km: 0, is_active: 0, notes: '引退済み' },
  ];
  const insertShoe = db.prepare('INSERT INTO shoes (id, name, purchase_date, total_km, is_active, notes) VALUES (?, ?, ?, ?, ?, ?)');
  for (const s of shoes) insertShoe.run(s.id, s.name, s.purchase_date, s.total_km, s.is_active, s.notes);

  // --- Phases ---
  const phases = [
    { id: uuidv4(), name: '基礎期', start_date: '2025-12-01', end_date: '2025-12-31', color: '#3B82F6', notes: '有酸素ベース構築。LSD中心。週60km目標', created_at: now },
    { id: uuidv4(), name: 'ビルドアップ期', start_date: '2026-01-01', end_date: '2026-04-30', color: '#10B981', notes: '閾値走・インターバル導入。週80km目標', created_at: now },
    { id: uuidv4(), name: 'ピーク期', start_date: '2026-05-01', end_date: '2026-05-31', color: '#F59E0B', notes: 'レースシミュレーション・テーパリング', created_at: now },
    { id: uuidv4(), name: '回復期', start_date: '2026-06-01', end_date: null, color: '#8B5CF6', notes: 'レース後回復。ジョグ中心', created_at: now },
  ];
  const insertPhase = db.prepare('INSERT INTO phases (id, name, start_date, end_date, color, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of phases) insertPhase.run(p.id, p.name, p.start_date, p.end_date, p.color, p.notes, p.created_at);

  // Helper to find phase_id
  const getPhaseId = (date) => {
    const p = db.prepare("SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1").get(date, date);
    return p ? p.id : null;
  };

  // --- Dummy Sessions (December 2025 – January 2026, June 2026) ---
  const dummySessions = [
    mkSession('2025-12-01', 'running', { menu: 'ジョグ', memo: 'フォームを意識してリラックス走。肩の力を抜く', locate: '皇居', shoes: 'neo zen', distance: 8.2, duration: 3198, hr: 129, elev: 48, cs: 91, vo2max: 56.2, gc: 248, gcb: 49.8, vo: 9.2, cadMax: 187, cadAvg: 176, stride: 148, gcBalance: '49.8% - 50.2%', title: 'Morning Easy Run', impression: '久しぶりのランだったが足は軽かった。ペースより心拍を意識して走れた。' }),
    mkSession('2025-12-03', 'running', { menu: '400mインターバル×8', memo: '400m 1:42-1:45, rest 200m jog。ラスト2本は垂れた', locate: '国立競技場外周', shoes: 'SPEED 4', distance: 12.4, duration: 3720, hr: 156, elev: 22, cs: 95, vo2max: 57.1, gc: 225, gcb: 50.5, vo: 8.1, cadMax: 197, cadAvg: 183, stride: 163, gcBalance: '50.5% - 49.5%', title: '400m Intervals', impression: '5本目から心拍が上がらなくなってきた。疲労あり。最後まで諦めずに走り切れた。' }),
    mkSession('2025-12-05', 'rest', { menu: 'ランオフ', memo: '足の疲労感あり。アイシングとストレッチのみ' }),
    mkSession('2025-12-07', 'running', { menu: 'LSD', memo: '6:30-6:45/kmで一定ペース。終盤は6:50まで落とした', locate: '多摩川CR', shoes: 'SUPERBLAST 2', distance: 21.5, duration: 8688, hr: 133, elev: 112, cs: 89, vo2max: 56.8, gc: 252, gcb: 50.1, vo: 9.5, cadMax: 185, cadAvg: 174, stride: 152, gcBalance: '50.1% - 49.9%', title: 'Long Slow Distance', impression: '20km超えてからペース維持が難しくなった。補給タイミングが遅れた反省。' }),
    mkSession('2025-12-10', 'manual', { menu: '体幹トレーニング', memo: 'プランク3分×3, シングルレッグスクワット20×3, ヒップヒンジ, バードドッグ', locate: '自宅' }),
    mkSession('2025-12-12', 'running', { menu: 'ペース走15km', memo: '5:15-5:20/kmで15km。前半は抑えて後半上げ', locate: '皇居', shoes: 'SUPERBLAST 2', distance: 15.1, duration: 4773, hr: 148, elev: 65, cs: 93, vo2max: 57.3, gc: 238, gcb: 50.3, vo: 8.6, cadMax: 191, cadAvg: 180, stride: 159, gcBalance: '50.3% - 49.7%', title: 'Tempo Run 15km', impression: '10km以降は乳酸が溜まってきた感覚。後半のペース維持は合格点。' }),
    mkSession('2025-12-14', 'rest', { menu: 'ランオフ', memo: '完全休養。睡眠8時間取れた' }),
    mkSession('2025-12-17', 'running', { menu: 'イージーラン', memo: '会話できるペースで気持ちよく走った', locate: '皇居', shoes: 'neo zen', distance: 10.0, duration: 3900, hr: 130, elev: 55, cs: 90, vo2max: 56.5, gc: 250, gcb: 49.9, vo: 9.3, cadMax: 184, cadAvg: 175, stride: 150, gcBalance: '49.9% - 50.1%', title: 'Easy Run', impression: '心拍が低く保てた。体調は良好。' }),
    mkSession('2025-12-19', 'running', { menu: '1000m×5 インターバル', memo: '1000m 3:58-4:05, rest 400m jog。4本目以降ペース落ちた', locate: '国立競技場外周', shoes: 'SPEED 4', distance: 13.8, duration: 4320, hr: 160, elev: 28, cs: 96, vo2max: 57.8, gc: 222, gcb: 50.8, vo: 7.9, cadMax: 199, cadAvg: 186, stride: 168, gcBalance: '50.8% - 49.2%', title: '1000m Intervals', impression: '4分切りは3本しかできなかった。VO2maxセッションとしては上出来。疲労困憊。' }),
    mkSession('2025-12-21', 'rest', { menu: 'ランオフ', memo: 'インターバル後の疲労で足が重い。温浴+ストレッチ' }),
    mkSession('2025-12-24', 'running', { menu: 'LSD 22km', memo: 'マラソンペース+45秒くらいで余裕を持って。後半は気持ちよく走れた', locate: '多摩川CR', shoes: 'SUPERBLAST 2', distance: 22.3, duration: 9336, hr: 136, elev: 98, cs: 90, vo2max: 57.2, gc: 246, gcb: 50.2, vo: 9.1, cadMax: 186, cadAvg: 175, stride: 155, gcBalance: '50.2% - 49.8%', title: 'Christmas Long Run', impression: 'クリスマスランを楽しめた。20km以降も余裕あり。基礎ができてきた感覚。' }),
    mkSession('2025-12-28', 'running', { menu: 'リカバリージョグ', memo: '週の締めくくりに軽く。足は元気', locate: '近所', shoes: 'neo zen', distance: 6.0, duration: 2520, hr: 124, elev: 18, cs: 88, vo2max: 56.9, gc: 255, gcb: 50.0, vo: 9.6, cadMax: 182, cadAvg: 172, stride: 144, gcBalance: '50.0% - 50.0%', title: 'Recovery Jog', impression: '気持ちよく締めくくれた。12月はいい練習ができた。' }),
    mkSession('2026-01-04', 'running', { menu: 'ジョグ 年始め', memo: '年始一発目。無理せずジョグ', locate: '皇居', shoes: 'neo zen', distance: 8.0, duration: 3120, hr: 127, elev: 45, cs: 90, vo2max: 56.8, gc: 249, gcb: 50.0, vo: 9.3, cadMax: 185, cadAvg: 175, stride: 149, gcBalance: '50.0% - 50.0%', title: 'New Year Easy Run', impression: '年始一発目。足は重かったが走れた。今年も頑張ろう。' }),
    mkSession('2026-01-07', 'running', { menu: '800m×6 インターバル', memo: '800m 3:08-3:15。スピードが戻ってきた感覚', locate: '国立競技場外周', shoes: 'SPEED 4', distance: 10.5, duration: 3240, hr: 157, elev: 20, cs: 95, vo2max: 57.5, gc: 228, gcb: 50.6, vo: 8.2, cadMax: 196, cadAvg: 184, stride: 164, gcBalance: '50.6% - 49.4%', title: '800m Intervals x6' }),
    mkSession('2026-01-11', 'running', { menu: 'LSD 18km', memo: 'ゆっくり丁寧に。フォームを意識', locate: '多摩川CR', shoes: 'SUPERBLAST 2', distance: 18.0, duration: 7380, hr: 133, elev: 88, cs: 89, vo2max: 57.0, gc: 251, gcb: 49.9, vo: 9.4, cadMax: 184, cadAvg: 174, stride: 153, gcBalance: '49.9% - 50.1%', title: 'Long Run 18km', impression: 'ラスト3kmで少し落ちたが全体的にOK。基礎期の成果が出ている。' }),
    mkSession('2026-01-14', 'rest', { menu: 'ランオフ', memo: 'ハードウィーク後の休養' }),
    mkSession('2026-01-17', 'running', { menu: 'ペース走 12km', memo: '5:05-5:10/kmで安定。後半切り上げ', locate: '皇居', shoes: 'SUPERBLAST 2', distance: 12.0, duration: 3660, hr: 149, elev: 58, cs: 93, vo2max: 57.8, gc: 236, gcb: 50.4, vo: 8.5, cadMax: 192, cadAvg: 181, stride: 161, gcBalance: '50.4% - 49.6%', title: 'Tempo Run 12km' }),
    mkSession('2026-06-01', 'running', { menu: 'リカバリージョグ 6km', memo: 'レース後初ラン。無理せず流す', locate: '近所', shoes: 'neo zen', distance: 6.2, duration: 2728, hr: 122, elev: 15, cs: 87, vo2max: 58.2, gc: 258, gcb: 50.2, vo: 9.7, cadMax: 181, cadAvg: 171, stride: 143, gcBalance: '50.2% - 49.8%', title: 'Post-Race Recovery', impression: 'ウルトラ後の体。足は張っているが走ること自体は快適。焦らず回復させる。' }),
    mkSession('2026-06-03', 'running', { menu: 'イージーラン 10km', memo: '徐々に距離を戻す。7:00/km以下は出さない', locate: '皇居', shoes: 'neo zen', distance: 10.0, duration: 4200, hr: 126, elev: 52, cs: 89, vo2max: 58.0, gc: 252, gcb: 50.1, vo: 9.4, cadMax: 183, cadAvg: 173, stride: 147, gcBalance: '50.1% - 49.9%', title: 'Recovery Easy 10km', impression: '少しずつ調子が戻ってきた感覚。ペースより心拍重視で。' }),
  ];

  // Assign phase_id to dummy sessions
  for (const s of dummySessions) s.phase_id = getPhaseId(s.date);

  // Load sample sessions from JSON (actual FIT data)
  const sampleSessions = loadSampleSessions();
  for (const s of sampleSessions) s.phase_id = getPhaseId(s.date);

  const allSessions = [...dummySessions, ...sampleSessions];

  const cols = [
    'id','activity_type','suunto_workout_id','phase_id','date','menu','memo','locate','shoes',
    'distance_km','duration_s','pace_per_km_s','avg_hr_pct','elevation_m','cadence_score','energy_kcal',
    'title','trimp','vo2max','ground_contact_ms','gcb_left_pct','vertical_oscillation_cm',
    'cadence_max_spm','cadence_avg_spm','stride_length_cm','gc_balance',
    'impression','claude_eval','claude_eval_at','gpt_eval','gpt_eval_at','created_at','updated_at',
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO sessions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  const insertMany = db.transaction(rows => { for (const r of rows) insert.run(cols.map(c => r[c] ?? null)); });
  insertMany(allSessions);

  // Update shoes total_km
  for (const shoe of shoes) {
    const r = db.prepare('SELECT COALESCE(SUM(distance_km),0) as total FROM sessions WHERE shoes = ?').get(shoe.name);
    db.prepare('UPDATE shoes SET total_km = ? WHERE name = ?').run(Math.round(r.total * 10) / 10, shoe.name);
  }

  console.log(`Seeded: ${dummySessions.length} dummy sessions + ${sampleSessions.length} sample FIT sessions, ${phases.length} phases, ${shoes.length} shoes.`);
}

function reloadLapsStore() {
  // 1. sample_sessions.json のラップをメモリに再ロード
  const samplePath = path.join(__dirname, '../../data/sample_sessions.json');
  if (fs.existsSync(samplePath)) {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    for (const s of raw) {
      if (s.laps && s.laps.length) lapsStore.setLaps(s.id, s.laps);
    }
  }

  // 2. data/suunto_raw/ の生JSONからラップを再ロード（date+distance+durationでセッション特定）
  const rawDir = path.join(__dirname, '../../data/suunto_raw');
  if (!fs.existsSync(rawDir)) return;

  const { parseSession } = require('../lib/suunto-parser');
  const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));

  for (const filename of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(rawDir, filename), 'utf8'));
      const { session, laps } = parseSession(raw, filename);
      if (!laps || !laps.length) continue;
      const row = db.prepare(
        'SELECT id FROM sessions WHERE date = ? AND distance_km = ? AND duration_s = ?'
      ).get(session.date, session.distance_km, session.duration_s);
      if (row) lapsStore.setLaps(row.id, laps);
    } catch (_) {}
  }
}

module.exports = { seedIfEmpty };
