const { randomBytes, randomUUID } = require('node:crypto');
const { buildModelConfig } = require('./model-config');
const { compareAnswers } = require('./model');
const { localComparison } = require('./similarity');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function text(value, name, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(400, name + '格式不正确（最多 ' + max + ' 字）。');
  }
  return value.trim();
}
function questionOf(value) {
  if (!value || typeof value !== 'object') throw new HttpError(400, '请选择或填写题目。');
  const questionText = text(value.questionText, '题目', 500);
  const options = value.options ?? [];
  if (!Array.isArray(options) || options.length > 8)
    throw new HttpError(400, '最多支持 8 个选项。');
  const normalized = options.map((option) => text(option, '选项', 120));
  if (normalized.length === 1 || new Set(normalized).size !== normalized.length)
    throw new HttpError(400, '请填写至少两个不同选项，或全部留空。');
  return {
    questionText,
    options: normalized,
    questionType: normalized.length ? 'multiple-choice' : 'free-text',
  };
}
class RoomStore {
  constructor({
    compare = compareAnswers,
    now = Date.now,
    ttlMs = 24 * 60 * 60 * 1000,
    maxRooms = 1000,
    env = process.env,
  } = {}) {
    this.rooms = new Map();
    this.compare = compare;
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxRooms = maxRooms;
    this.env = env;
  }
  cleanup() {
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= this.now()) {
        room.modelConfig.apiKey = '';
        this.rooms.delete(id);
      }
    }
  }
  get(id) {
    this.cleanup();
    const room = this.rooms.get(id);
    if (!room) throw new HttpError(404, '房间不存在或已过期，请创建新房间。');
    return room;
  }
  member(room, token) {
    const member = room.members.find((item) => item.token === token);
    if (!member) throw new HttpError(403, '请先加入房间，或在原来的浏览器标签页中打开。');
    return member;
  }
  create(payload) {
    this.cleanup();
    if (this.rooms.size >= this.maxRooms) throw new HttpError(503, '房间已满，请稍后重试。');
    const nickname = text(payload.nickname, '昵称', 30);
    const question = questionOf(payload.question);
    let modelConfig;
    try {
      modelConfig = buildModelConfig(payload.apiConfig, this.env);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    if (modelConfig.provider !== 'local' && payload.consent !== true)
      throw new HttpError(400, '请确认允许将双方回答发送给 OpenAI。');
    let id;
    do {
      id = randomBytes(6).toString('hex').toUpperCase();
    } while (this.rooms.has(id));
    const host = {
      id: randomUUID(),
      nickname,
      token: randomBytes(32).toString('base64url'),
      host: true,
    };
    const room = {
      id,
      question,
      modelConfig,
      members: [host],
      round: 1,
      submissions: new Map(),
      result: null,
      pending: null,
      history: [],
      expiresAt: this.now() + this.ttlMs,
    };
    this.rooms.set(id, room);
    return { token: host.token, ...this.view(room, host) };
  }
  join(room, payload, token) {
    const existing = room.members.find((item) => item.token === token);
    if (existing) return { token, ...this.view(room, existing) };
    const nickname = text(payload.nickname, '昵称', 30);
    if (room.members.length >= 2) throw new HttpError(409, '这是双人房间，已经满员。');
    if (room.members.some((item) => item.nickname === nickname))
      throw new HttpError(409, '昵称已被使用，请换一个。');
    if (room.modelConfig.provider !== 'local' && payload.consent !== true)
      throw new HttpError(400, '本房间使用 OpenAI，请先确认允许发送回答。');
    const member = {
      id: randomUUID(),
      nickname,
      token: randomBytes(32).toString('base64url'),
      host: false,
    };
    room.members.push(member);
    return { token: member.token, ...this.view(room, member) };
  }
  preview(room) {
    return {
      roomId: room.id,
      participantCount: room.members.length,
      expiresAt: room.expiresAt,
      analysis: { provider: room.modelConfig.provider, model: room.modelConfig.model },
    };
  }
  view(room, member) {
    return {
      ...this.preview(room),
      me: member.id,
      isHost: member.host,
      round: room.round,
      question: room.question,
      status: room.result ? 'ready' : room.pending ? 'analyzing' : 'waiting',
      participants: room.members.map(({ id, nickname, host }) => ({
        id,
        nickname,
        host,
        submitted: room.submissions.has(id),
      })),
      submissionCount: room.submissions.size,
      mySubmission: room.submissions.get(member.id) || null,
      answers: room.result ? this.answers(room) : null,
      result: room.result,
      history: room.history,
    };
  }
  answers(room) {
    return room.members.map(({ id, nickname }) => ({ nickname, ...room.submissions.get(id) }));
  }
  submit(room, member, payload) {
    if (payload.round !== room.round)
      throw new HttpError(409, '题目已经更新，请按当前题目重新回答。');
    // A retry after a lost response must not trigger another billable model request.
    if (room.submissions.has(member.id)) return this.view(room, member);
    const answerText = text(payload.answerText ?? '', '回答', 4000, false);
    const selectedOption = text(payload.selectedOption ?? '', '选项', 120, false);
    if (!answerText && !selectedOption) throw new HttpError(400, '请选择选项或写下你的想法。');
    if (selectedOption && !room.question.options.includes(selectedOption))
      throw new HttpError(400, '请选择当前题目中的选项。');
    room.submissions.set(member.id, { answerText, selectedOption });
    if (room.submissions.size === 2) {
      const [first, second] = room.members.map((item) => room.submissions.get(item.id));
      // Set pending synchronously so concurrent submissions cannot start multiple comparisons.
      room.pending = Promise.resolve()
        .then(() => this.compare(room.question, first, second, room.modelConfig))
        .then((result) => {
          room.result = result || localComparison(first, second);
        })
        .catch(() => {
          room.result = localComparison(first, second, 'AI 暂时不可用，已切换为本地比较。');
        })
        .finally(() => {
          room.pending = null;
        });
    }
    return this.view(room, member);
  }
  next(room, member, payload) {
    if (!member.host) throw new HttpError(403, '只有房主可以开启下一轮。');
    if (payload.round !== room.round || !room.result || room.pending)
      throw new HttpError(409, '请等待本轮完成后再开启下一轮。');
    if (room.round >= 20) throw new HttpError(409, '已完成 20 轮，请创建新房间。');
    const question = questionOf(payload.question);
    room.history.push({
      round: room.round,
      question: room.question,
      answers: this.answers(room),
      result: room.result,
    });
    room.round += 1;
    room.question = question;
    room.submissions = new Map();
    room.result = null;
    return this.view(room, member);
  }
}
module.exports = { RoomStore, HttpError, questionOf };
