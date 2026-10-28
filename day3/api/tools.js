// api/tools.js — 에이전트가 쓰는 두 도구: find_spots(관광지 찾기) · get_weather(날씨, Open-Meteo 키 없음)
// 데이터: area · indoor · desc · lat/lon 이 들어 있는 jeju_spots.json (같은 폴더)

const DATA = require('./jeju_spots.json');
const SPOTS = DATA.spots;
const AREAS = DATA.areas;                                   // { 동쪽: [lat, lon], ... }
const AREA_NAMES = Object.keys(AREAS);                      // 동쪽 · 서쪽 · 서귀포 · 제주시
const MAX_SPOTS = 8;

// ── 도구 ① 관광지 찾기 (좌표는 화면용이라 뺀다) ──
function find_spots({ area, indoor } = {}) {
  let list = SPOTS.filter(s => s.area === area);
  if (indoor === true || indoor === false) list = list.filter(s => s.indoor === indoor);
  return {
    area,
    count: list.length,
    spots: list.slice(0, MAX_SPOTS).map(s => ({ name: s.name, area: s.area, indoor: s.indoor, desc: s.desc })),
  };
}

// ── 도구 ② 날씨 보기 (Open-Meteo 예보, 키 없음) ──
async function get_weather({ area, day } = {}) {
  const c = AREAS[area] || AREAS['제주시'];
  const i = day === '내일' ? 1 : 0;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}` +
    '&daily=precipitation_probability_max,temperature_2m_max&timezone=Asia%2FSeoul&forecast_days=2';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('weather ' + r.status);
    const j = await r.json();
    return {
      ok: true, area, day: day || '오늘', date: j.daily.time[i],
      rain_prob: j.daily.precipitation_probability_max[i],
      tmax: Math.round(j.daily.temperature_2m_max[i]),
      source: 'Open-Meteo 예보',
    };
  } catch (e) {
    return { ok: false, area, day, note: '날씨를 가져오지 못했어요' };
  }
}

// ── Claude 도구 설명 ──
const find_spots_tool = {
  name: 'find_spots',
  description: '제주 관광지 목록에서 지역(그리고 실내/야외)으로 장소를 찾아 이름 · 지역 · 실내 여부 · 설명을 최대 8곳 돌려준다. 목록 밖 장소는 없다.',
  input_schema: {
    type: 'object',
    properties: {
      area: { type: 'string', enum: AREA_NAMES, description: '찾을 지역' },
      indoor: { type: 'boolean', description: '실내만 true, 야외만 false, 둘 다면 생략' },
    },
    required: ['area'],
  },
};

const get_weather_tool = {
  name: 'get_weather',
  description: '그 지역의 오늘 또는 내일 강수확률(%)과 최고기온(℃)을 Open-Meteo 예보로 가져온다.',
  input_schema: {
    type: 'object',
    properties: {
      area: { type: 'string', enum: AREA_NAMES, description: '날씨를 볼 지역' },
      day: { type: 'string', enum: ['오늘', '내일'] },
    },
    required: ['area', 'day'],
  },
};

const TOOLS = [find_spots_tool, get_weather_tool];
// Gemini 는 같은 설명을 functionDeclarations(parameters) 형태로 받는다
const GEMINI_TOOLS = [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];

module.exports = {
  find_spots, get_weather, find_spots_tool, get_weather_tool,
  TOOLS, GEMINI_TOOLS,
  SPOTS, AREA_NAMES,
};
