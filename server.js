const http = require('http');
const path = require('path');
const fs = require('fs');
const { fallbackSimilarity, parseModelSimilarity } = require('./src/similarity');
const { buildModelConfig } = require('./src/model-config');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PRESET_QUESTIONS = [
  {
    id: 'market-vs-welfare',
    questionType: 'multiple-choice',
    title: '政府应优先保障市场自由还是社会福利？',
    options: ['优先市场自由', '优先社会福利', '两者平衡'],
  },
  {
    id: 'free-speech-limit',
    questionType: 'multiple-choice',
    title: '仇恨言论是否应受到更严格限制？',
    options: ['应严格限制', '应尽量保护言论自由', '视具体情境而定'],
  },
  {
    id: 'ai-regulation',
    questionType: 'free-text',
    title: '你认为AI伦理治理最关键的原则是什么？',
    options: [],
  },
  {id: 'human-nature-good-or-evil',
    questionType: 'multiple-choice',
    title: '人性本善还是本恶？',
    options: ['人性本善，道德是人的天性', '人性本恶，道德是后天教化的结果', '人性无善无恶，受环境影响']
  }
];

const rooms = new Map();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not Found' });
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((item) => String(item || '').trim()).filter(Boolean);
}

function sameQuestion(existing, incoming) {
  if (!existing || !incoming) return false;
  const exOptions = normalizeOptions(existing.options);
  const inOptions = normalizeOptions(incoming.options);

  return (
    String(existing.questionType) === String(incoming.questionType) &&
    String(existing.questionText).trim() === String(incoming.questionText).trim() &&
    JSON.stringify(exOptions) === JSON.stringify(inOptions)
  );
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function callSimilarityModel(question, first, second, modelConfig) {
  if (!modelConfig.apiKey) {
    return null;
  }

  const payload = {
    model: modelConfig.model,
    messages: [
      {
        role: 'system',
        content:
          '你是政治和哲学立场分析助手。比较两个人对同一问题的回答，返回JSON：{"similarity":0-100,"reason":"简短解释","leaning":"共同倾向"}。只输出JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question,
          participantA: first,
          participantB: second,
        }),
      },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const response = await fetch(`${modelConfig.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + modelConfig.apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`模型调用失败: ${response.status}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  return parseModelSimilarity(content);
}

async function ensureResult(room, modelConfig) {
  const participants = Array.from(room.submissions.values());
  if (participants.length < 2) return null;

  const [first, second] = participants;

  try {
    const modelResult = await callSimilarityModel(room.question, first, second, modelConfig);
    if (modelResult) {
      room.result = {
        ...modelResult,
        provider: modelConfig.provider,
      };
      return room.result;
    }
  } catch (error) {
    room.lastModelError = error.message;
  }

  room.result = {
    similarity: fallbackSimilarity(first.fullAnswer, second.fullAnswer),
    reason: '使用本地相似度算法（关键词重合度）生成结果。',
    leaning: '待进一步判断',
    provider: `${modelConfig.provider}-fallback`,
  };
  return room.result;
}

function toSubmission(userId, answerText, selectedOption) {
  const picked = selectedOption ? `选择项: ${selectedOption}` : '';
  return {
    userId,
    answerText,
    selectedOption: selectedOption || '',
    fullAnswer: [picked, answerText].filter(Boolean).join('\n'),
    submittedAt: new Date().toISOString(),
  };
}

async function handleSubmit(req, res, roomId) {
  let payload;
  try {
    payload = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: '请求体必须是JSON' });
    return;
  }

  const userId = String(payload.userId || '').trim();
  const questionText = String(payload.questionText || '').trim();
  const questionType = String(payload.questionType || 'free-text');
  const answerText = String(payload.answerText || '').trim();
  const selectedOption = String(payload.selectedOption || '').trim();
  const options = normalizeOptions(payload.options);

  if (!userId || !questionText || !answerText) {
    sendJson(res, 400, { error: 'userId、questionText、answerText 为必填项' });
    return;
  }

  let room = rooms.get(roomId);
  const incomingQuestion = { questionText, questionType, options };

  if (!room) {
    room = {
      id: roomId,
      question: incomingQuestion,
      submissions: new Map(),
      result: null,
      lastModelError: null,
    };
    rooms.set(roomId, room);
  } else if (!sameQuestion(room.question, incomingQuestion)) {
    sendJson(res, 409, { error: '同一个房间需要回答同一道题，请检查题目文本和备选项。' });
    return;
  }

  room.submissions.set(userId, toSubmission(userId, answerText, selectedOption));

  let modelConfig;
  try {
    modelConfig = buildModelConfig(payload.apiConfig || {});
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }
  const result = await ensureResult(room, modelConfig);

  sendJson(res, 200, {
    roomId,
    participantCount: room.submissions.size,
    status: result ? 'ready' : 'waiting',
    provider: modelConfig.provider,
    result,
    modelError: room.lastModelError,
  });
}

function handleResult(req, res, roomId, query) {
  const room = rooms.get(roomId);
  if (!room) {
    sendJson(res, 404, { error: '房间不存在' });
    return;
  }

  const userId = String(query.get('userId') || '').trim();
  if (userId && !room.submissions.has(userId)) {
    sendJson(res, 403, { error: '该用户尚未在房间内提交回答' });
    return;
  }

  sendJson(res, 200, {
    roomId,
    question: room.question,
    participantCount: room.submissions.size,
    status: room.result ? 'ready' : 'waiting',
    result: room.result,
    modelError: room.lastModelError,
  });
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      notFound(res);
      return;
    }

    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/preset-questions') {
    sendJson(res, 200, { questions: PRESET_QUESTIONS });
    return;
  }

  const submitMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/submit$/);
  if (req.method === 'POST' && submitMatch) {
    await handleSubmit(req, res, submitMatch[1]);
    return;
  }

  const resultMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/result$/);
  if (req.method === 'GET' && resultMatch) {
    handleResult(req, res, resultMatch[1], url.searchParams);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
