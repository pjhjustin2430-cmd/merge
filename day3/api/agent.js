// api/agent.js — 도구를 스스로 골라 쓰는 제주 여행 에이전트 (Vercel 서버 함수)
// 도구: find_spots(관광지 찾기) · get_weather(날씨, Open-Meteo)
// AI: Google Gemini API (함수 호출). 열쇠는 Vercel 환경변수 GEMINI_API_KEY 에서만 읽습니다. 이 파일에 열쇠를 쓰지 마세요.
// 열쇠가 없으면 '연습 모드' — AI 대신 정해 둔 순서(찾기 → 날씨 → 규칙 판단)로 같은 도구를 씁니다.

const { find_spots, get_weather, GEMINI_TOOLS, SPOTS } = require('./tools');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const RAIN = 50;                                            // 판단 규칙: 강수확률 50% 이상이면 실내 위주
const MAX_TURNS = 5;                                        // 에이전트 반복은 5번까지

async function runTool(name, input) {
  if (name === 'find_spots') return find_spots(input || {});
  if (name === 'get_weather') return get_weather(input || {});
  return { error: '없는 도구' };
}
function toolStep(name, input, out) {                       // ‘생각 과정’에 보일 한 줄
  if (name === 'find_spots') return `관광지 찾기 — ${out.area}${input.indoor === true ? ' 실내' : input.indoor === false ? ' 야외' : ''} ${out.count}곳`;
  if (name === 'get_weather') return out.ok ? `날씨 보기 — ${out.area} ${out.day} 강수확률 ${out.rain_prob}% · 최고 ${out.tmax}℃ (${out.source})` : `날씨 보기 — ${out.note}`;
  return name;
}

const SYSTEM = [
  '너는 제주 여행 안내 에이전트 ‘오름 길잡이’야. 존댓말, 짧게, 모르는 건 모른다고 말해.',
  '반드시 도구로 확인한 뒤 답해: find_spots 로 장소를 찾고, get_weather 로 그 지역 날씨를 봐.',
  `판단 규칙: 강수확률 ${RAIN}% 이상이면 실내 위주 · 코스는 한 지역 안에서 · find_spots 에 없는 장소는 추천하지 마 · 날씨를 못 가져오면 그렇다고 말해 · 운영시간과 요금은 단정하지 마.`,
  '최종 답은 JSON 으로만: {"places":[{"name":"","why":""}],"judge":"한 줄 판단 이유","tip":""} — 장소는 3곳.',
].join('\n');

const REGION_WORDS = [['동쪽', ['동쪽', '동부', '성산', '구좌', '표선', '우도']], ['서쪽', ['서쪽', '서부', '애월', '협재', '한림', '안덕']], ['서귀포', ['서귀포', '남쪽', '중문', '남원']], ['제주시', ['제주시', '시내', '공항', '구도심']]];
const norm = s => String(s || '').replace(/[\s()·\-]/g, '');
const spotOf = name => SPOTS.find(s => norm(s.name) === norm(name) || norm(s.name).includes(norm(name)) || norm(name).includes(norm(s.name)));

function finish(places) {                                   // 목록과 대조 + 지도 좌표 붙이기
  return (places || []).slice(0, 3).map(p => {
    const s = spotOf(p.name);
    return s ? { name: s.name, why: p.why, area: s.area, indoor: s.indoor, lat: s.lat, lon: s.lon, inList: true } : { name: p.name, why: p.why, inList: false };
  });
}

// ── 연습 모드: AI 대신 정해 둔 순서로 같은 도구를 쓴다 ──
async function practiceAgent(question) {
  const area = (REGION_WORDS.find(([, ws]) => ws.some(w => question.includes(w))) || ['동쪽'])[0];
  const day = /내일/.test(question) ? '내일' : '오늘';
  const steps = [];
  const found = find_spots({ area }); steps.push({ kind: 'find', text: toolStep('find_spots', { area }, found) });
  const w = await get_weather({ area, day }); steps.push({ kind: 'find', text: toolStep('get_weather', { area, day }, w) });
  const askRain = /비\s?(와|오|올)/.test(question);
  const indoorFirst = askRain || (w.ok && w.rain_prob >= RAIN);
  const judge = askRain ? '질문에 “비”가 있어 실내 위주' : !w.ok ? '날씨를 몰라 실내 · 야외 섞기' : indoorFirst ? `강수확률 ${w.rain_prob}% ≥ ${RAIN}% → 실내 위주` : `강수확률 ${w.rain_prob}% < ${RAIN}% → 야외도 OK`;
  steps.push({ kind: 'judge', text: judge });
  const pool = SPOTS.filter(s => s.area === area);
  const sorted = w.ok || askRain ? pool.slice().sort((a, b) => (b.indoor === indoorFirst) - (a.indoor === indoorFirst)) : pool;
  const places = finish(sorted.slice(0, 3).map(s => ({ name: s.name, why: s.desc })));
  steps.push({ kind: 'act', text: `${area} 코스 ${places.length}곳 · 지도 핀` });
  return { mode: 'practice', steps, places, judge, weather: w, tip: '연습 모드(정해 둔 순서) · 방문 전 운영 여부를 확인하세요.' };
}

async function askGemini(key, contents) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, tools: GEMINI_TOOLS, contents }),
  });
  if (!r.ok) throw new Error('gemini ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 로만 물어봐 주세요' });
  const body = req.body || {};
  const question = String(body.question || '').slice(0, 300);
  if (!question.trim()) return res.status(400).json({ error: '질문이 비어 있어요' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json(await practiceAgent(question));

  const steps = [];
  const contents = [{ role: 'user', parts: [{ text: question }] }];
  let weather = null;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {            // 에이전트 반복: 도구 고르기 → 결과 보기 → 다시 판단
      const r = await askGemini(key, contents);
      const content = r.candidates && r.candidates[0] && r.candidates[0].content;
      if (!content) throw new Error('gemini 응답이 비어 있음');
      const parts = content.parts || [];
      const calls = parts.filter(p => p.functionCall);
      if (calls.length) {
        contents.push(content);                               // 모델 응답을 그대로 이어 붙인다
        const results = [];
        for (const p of calls) {
          const { name, args } = p.functionCall;
          const out = await runTool(name, args);
          if (name === 'get_weather') weather = out;
          steps.push({ kind: 'find', text: toolStep(name, args || {}, out) });
          results.push({ functionResponse: { name, response: out } });
        }
        contents.push({ role: 'user', parts: results });
        continue;
      }
      const text = parts.map(p => p.text || '').join('');
      let out;
      try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
      catch (e) { return res.status(200).json({ mode: 'ai', steps, text }); }
      const places = finish(out.places);
      steps.push({ kind: 'judge', text: out.judge || '판단 이유를 말하지 않았어요' });
      steps.push({ kind: 'act', text: `코스 ${places.length}곳 · 지도 핀 ${places.filter(p => p.lat).length}개` + (places.some(p => !p.inList) ? ' · 목록에 없는 곳은 직접 확인 ⚠' : '') });
      return res.status(200).json({ mode: 'ai', steps, places, judge: out.judge, weather, tip: out.tip || '방문 전 운영 여부를 확인하세요.' });
    }
    return res.status(200).json({ mode: 'ai', steps, text: '도구를 너무 여러 번 써서 멈췄어요. 질문을 조금 더 구체적으로 해 주세요.' });
  } catch (e) {
    const p = await practiceAgent(question);                  // AI 연결이 안 되면 연습 모드로
    return res.status(200).json({ ...p, mode: 'error', tip: '잠시 AI 연결이 안 돼 연습 모드로 답했어요. (' + String(e.message).slice(0, 120) + ')' });
  }
};
