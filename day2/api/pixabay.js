// Vercel 서버리스 함수: 브라우저에는 API 키를 노출하지 않고 서버에서만 사용한다.
module.exports = async (req, res) => {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'PIXABAY_API_KEY 환경변수가 설정되지 않았습니다.' });
    return;
  }

  const q = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  if (!q) {
    res.status(400).json({ error: '검색어를 입력해 주세요.' });
    return;
  }

  const url = 'https://pixabay.com/api/?' + new URLSearchParams({
    key, q, image_type: 'photo', per_page: '10', page: String(page),
  });

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'Pixabay 요청 실패 (' + upstream.status + ')' });
      return;
    }
    const data = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(200).json({ totalHits: data.totalHits, hits: data.hits });
  } catch (e) {
    res.status(502).json({ error: 'Pixabay 서버에 연결하지 못했습니다.' });
  }
};
