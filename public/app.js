'use strict';
const $ = (id) => document.getElementById(id);
let presets = [];
let session = null;
let state = null;
let preview = null;
let timer = null;
let generation = 0;
let shownRound = null;
let resultKey = '';
let historyKey = '';
let submitting = false;
let storageAvailable = true;

function message(value = '') {
  delete $('message').dataset.connection;
  $('message').textContent = value;
  $('message').hidden = !value;
}
function storage(action, key, value) {
  try {
    return sessionStorage[action](key, value);
  } catch {
    storageAvailable = false;
    return null;
  }
}
function tokenFor(id) {
  return storage('getItem', 'tongti:' + id);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function api(path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('暂时无法连接服务器，请检查网络后重试。');
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || '请求失败，请重试。');
    error.status = response.status;
    throw error;
  }
  return data;
}
async function busy(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
}
function setupEditor(containerId) {
  const container = $(containerId);
  container.append($('questionTemplate').content.cloneNode(true));
  const select = container.querySelector('select');
  for (const question of presets) {
    const option = element('option', question.title);
    option.value = question.id;
    select.append(option);
  }
  const custom = element('option', '＋ 写一道自己的问题');
  custom.value = 'custom';
  select.append(custom);
  select.addEventListener('change', () => {
    container.querySelector('.custom-fields').hidden = select.value !== 'custom';
  });
}
function readQuestion(containerId) {
  const container = $(containerId);
  const selected = container.querySelector('select').value;
  if (selected === 'custom') {
    return {
      questionText: container.querySelector('.custom-question').value.trim(),
      options: container
        .querySelector('.custom-options')
        .value.split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
    };
  }
  const preset = presets.find((q) => q.id === selected);
  if (!preset) throw new Error('题目尚未加载，请刷新后重试。');
  return { questionText: preset.title, options: preset.options };
}
function nickname() {
  const name = $('nickname').value.trim();
  if (!name) {
    $('nickname').focus();
    throw new Error('先填一个昵称，再开始对话。');
  }
  return name;
}
function roomFromHash() {
  return new URLSearchParams(location.hash.slice(1)).get('room') || '';
}
function roomPath(id = session?.roomId) {
  return '/api/rooms/' + encodeURIComponent(id);
}
function inviteUrl() {
  return location.origin + '/#room=' + session.roomId;
}

function enter(data, token) {
  generation += 1;
  clearTimeout(timer);
  session = { roomId: data.roomId, token: token || data.token };
  storage('setItem', 'tongti:' + session.roomId, session.token);
  history.replaceState(null, '', '#room=' + session.roomId);
  $('apiKey').value = '';
  $('lobby').hidden = true;
  $('room').hidden = false;
  shownRound = null;
  resultKey = '';
  historyKey = '';
  $('manualInvite').hidden = true;
  message(storageAvailable ? '' : '浏览器禁止保存会话，刷新后将无法恢复身份。请保持当前页面打开。');
  render(data);
  schedulePoll(generation);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function leave() {
  generation += 1;
  clearTimeout(timer);
  session = null;
  state = null;
  preview = null;
  history.replaceState(null, '', location.pathname);
  $('room').hidden = true;
  $('lobby').hidden = false;
  $('joinPreview').hidden = true;
  message();
}
function schedulePoll(run) {
  clearTimeout(timer);
  timer = setTimeout(() => poll(run), 1800);
}
async function poll(run) {
  if (!session || run !== generation) return;
  const active = session;
  try {
    const data = await api(roomPath(active.roomId), undefined, active.token);
    if (run !== generation) return;
    render(data);
    if ($('message').dataset.connection === 'lost') {
      message();
      delete $('message').dataset.connection;
    }
  } catch (error) {
    if (run !== generation) return;
    if (error.status === 403 || error.status === 404) {
      storage('removeItem', 'tongti:' + active.roomId);
      leave();
      message(error.message);
      return;
    }
    message(error.message + ' 正在自动重连，你写下的内容仍保留在页面中。');
    $('message').dataset.connection = 'lost';
  }
  if (run === generation) schedulePoll(run);
}
function render(data) {
  // Responses can arrive out of order while polling and submitting concurrently.
  if (
    state &&
    state.roomId === data.roomId &&
    (data.round < state.round ||
      (data.round === state.round &&
        (data.submissionCount < state.submissionCount ||
          data.participantCount < state.participantCount ||
          (state.result && !data.result))))
  )
    return;
  state = data;
  $('activeCode').textContent = data.roomId;
  $('roundBadge').textContent = '第 ' + data.round + ' 轮';
  $('analysisBadge').textContent = data.analysis.provider === 'local' ? '本地比较' : 'OpenAI';
  $('expiryNote').textContent =
    '房间有效至 ' + new Date(data.expiresAt).toLocaleString('zh-CN', { hour12: false }) + '。';
  $('questionTitle').textContent = data.question.questionText;
  if (shownRound !== data.round) {
    shownRound = data.round;
    $('answerText').value = '';
    $('answerOptions').replaceChildren();
    resultKey = '';
    const choices = data.question.options.length ? [...data.question.options, ''] : [];
    for (const choice of choices) {
      const label = element('label', undefined, 'option-label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'answerOption';
      input.value = choice;
      input.checked = !choice;
      label.append(input, element('span', choice || '不选选项，用自己的话回答'));
      $('answerOptions').append(label);
    }
  }
  if (data.mySubmission) {
    $('answerText').value = data.mySubmission.answerText;
    for (const input of $('answerOptions').querySelectorAll('input'))
      input.checked = input.value === data.mySubmission.selectedOption;
  }
  $('charCount').textContent = $('answerText').value.length + ' / 4000';
  $('answerFields').disabled = Boolean(data.mySubmission);
  $('submitBtn').disabled = Boolean(data.mySubmission) || submitting;
  $('submitBtn').textContent = data.mySubmission ? '已提交 · 本轮回答已锁定' : '提交我的回答 →';
  $('participants').replaceChildren();
  for (const person of data.participants) {
    const row = element('div', undefined, 'person');
    const name =
      person.nickname + (person.id === data.me ? '（你）' : '') + (person.host ? ' · 房主' : '');
    row.append(
      element('span', [...person.nickname][0], 'avatar'),
      element('span', name, 'person-name'),
      element('span', person.submitted ? '已提交 ✓' : '思考中', 'person-status'),
    );
    $('participants').append(row);
  }
  if (data.participantCount < 2) {
    const row = element('div', undefined, 'person');
    row.append(element('span', '+', 'avatar'), element('span', '等待朋友加入', 'person-name'));
    $('participants').append(row);
  }
  $('roundStatus').textContent =
    data.status === 'ready'
      ? '双方都已提交，一起看看下面的结果。'
      : data.status === 'analyzing'
        ? '双方已提交，正在整理共识与分歧…'
        : data.mySubmission
          ? '你的回答已保存，等待朋友提交。无需保持一直盯着屏幕。'
          : data.participantCount < 2
            ? '复制邀请链接给朋友。你也可以先写下自己的答案。'
            : '朋友已加入。各自提交后，答案会一起揭晓。';
  $('resultSection').hidden = !data.result;
  if (data.result && resultKey !== JSON.stringify(data.result)) {
    resultKey = JSON.stringify(data.result);
    const result = data.result;
    $('score').textContent = result.similarity === null ? '—' : result.similarity + '%';
    $('metric').textContent = result.metric + (result.similarity === null ? ' · 文字不足' : '');
    $('resultSource').textContent =
      result.provider === 'local' ? '本地计算 · 非观点评分' : 'OpenAI · ' + data.analysis.model;
    $('reason').textContent = result.reason;
    $('resultNotice').textContent = result.notice;
    answerCards($('answerComparison'), data.answers);
    list($('commonGround'), result.commonGround, '暂未识别明确共同点，可以从彼此的理由聊起。');
    list($('differences'), result.differences, '暂未识别明确分歧，不代表所有想法都一致。');
    $('followUp').textContent = result.followUp;
  }
  $('nextSection').hidden = !data.result || !data.isHost || data.round >= 20;
  $('guestNext').hidden = !data.result || data.isHost;
  if (data.round >= 20 && data.result)
    $('roundStatus').textContent = '已经完成 20 轮。可以下载记录，再从首页创建新房间。';
  $('historySection').hidden = !data.history.length;
  const nextHistoryKey = JSON.stringify(data.history);
  if (historyKey !== nextHistoryKey) {
    historyKey = nextHistoryKey;
    $('history').replaceChildren();
    for (const item of [...data.history].reverse()) {
      const details = element('details', undefined, 'history-item');
      details.append(
        element('summary', '第 ' + item.round + ' 轮 · ' + item.question.questionText),
      );
      details.append(
        element(
          'p',
          item.result.metric +
            '：' +
            (item.result.similarity === null ? '文字不足' : item.result.similarity + '%'),
          'hint',
        ),
      );
      details.append(element('p', item.result.reason));
      const cards = element('div', undefined, 'comparison-grid');
      answerCards(cards, item.answers);
      details.append(cards);
      details.append(element('p', '继续聊：' + item.result.followUp, 'hint'));
      $('history').append(details);
    }
  }
}
function answerCards(container, answers) {
  container.replaceChildren();
  for (const answer of answers) {
    const card = element('article', undefined, 'answer-card');
    card.append(
      element('h3', answer.nickname),
      element('p', answer.selectedOption || '自由回答', 'picked'),
      element('p', answer.answerText || '本轮只选择了选项。'),
    );
    container.append(card);
  }
}
function list(container, items, emptyText) {
  container.replaceChildren(
    ...(items.length ? items : [emptyText]).map((item) => element('li', item)),
  );
}
async function previewRoom(id) {
  id = id.trim().toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(id)) throw new Error('请输入完整的 12 位房间号。');
  const run = ++generation;
  clearTimeout(timer);
  const token = tokenFor(id);
  if (token) {
    try {
      const data = await api(roomPath(id), undefined, token);
      if (run === generation) enter(data, token);
      return;
    } catch (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
      storage('removeItem', 'tongti:' + id);
    }
  }
  const data = await api(roomPath(id));
  if (run !== generation) return;
  preview = data;
  $('roomCode').value = id;
  $('joinPreview').hidden = false;
  $('previewText').textContent =
    data.participantCount >= 2
      ? '这个房间已经有两位参与者了。'
      : data.analysis.provider === 'local'
        ? '朋友正在等你。本房间使用本地比较，不调用外部 AI。'
        : '本房间使用 OpenAI（' + data.analysis.model + '），题目和双方回答会发送给 OpenAI。';
  $('joinConsentLabel').hidden = data.analysis.provider === 'local';
  $('joinConsent').checked = false;
  $('joinBtn').disabled = data.participantCount >= 2;
  history.replaceState(null, '', '#room=' + id);
}
$('createForm').addEventListener('submit', (event) => {
  event.preventDefault();
  busy($('createBtn'), async () => {
    message();
    const data = await api('/api/rooms', {
      nickname: nickname(),
      question: readQuestion('createEditor'),
      apiConfig: {
        provider: $('provider').value,
        model: $('apiModel').value.trim(),
        apiKey: $('apiKey').value.trim(),
      },
      consent: $('createConsent').checked,
    });
    enter(data);
  });
});
$('provider').addEventListener('change', () => {
  $('modelFields').hidden = $('provider').value !== 'openai';
});
$('previewForm').addEventListener('submit', (event) => {
  event.preventDefault();
  busy(event.submitter, async () => {
    message();
    preview = null;
    $('joinPreview').hidden = true;
    await previewRoom($('roomCode').value);
  });
});
$('roomCode').addEventListener('input', () => {
  preview = null;
  $('joinPreview').hidden = true;
});
$('joinBtn').addEventListener('click', () =>
  busy($('joinBtn'), async () => {
    if (!preview) throw new Error('请先查看房间。');
    const data = await api(roomPath(preview.roomId) + '/join', {
      nickname: nickname(),
      consent: $('joinConsent').checked,
    });
    enter(data);
  }),
);
$('answerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!session || submitting || state.mySubmission) return;
  submitting = true;
  $('submitBtn').disabled = true;
  const run = generation;
  try {
    message();
    const data = await api(
      roomPath() + '/submit',
      {
        round: state.round,
        answerText: $('answerText').value.trim(),
        selectedOption: $('answerOptions').querySelector('input:checked')?.value || '',
      },
      session.token,
    );
    if (run === generation) render(data);
  } catch (error) {
    if (run === generation) message(error.message);
  } finally {
    submitting = false;
    if (run === generation) $('submitBtn').disabled = Boolean(state.mySubmission);
  }
});
$('nextForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const run = generation;
  busy(event.submitter, async () => {
    const data = await api(
      roomPath() + '/next',
      { round: state.round, question: readQuestion('nextEditor') },
      session.token,
    );
    if (run !== generation) return;
    message();
    render(data);
    $('questionTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});
$('answerText').addEventListener('input', () => {
  $('charCount').textContent = $('answerText').value.length + ' / 4000';
});
$('backBtn').addEventListener('click', leave);
$('copyBtn').addEventListener('click', async () => {
  const link = inviteUrl();
  try {
    await navigator.clipboard.writeText(link);
    message(
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? '链接已复制。当前是本机地址；邀请其他设备时，请使用同一局域网地址或部署后的网址。'
        : '邀请链接已复制，发给朋友就可以开始。',
    );
  } catch {
    $('manualInvite').hidden = false;
    $('inviteLink').value = link;
    $('inviteLink').select();
    message('请手动复制下方邀请链接。');
  }
});
$('exportBtn').addEventListener('click', () => {
  const rounds = [
    ...state.history,
    { round: state.round, question: state.question, answers: state.answers, result: state.result },
  ];
  const lines = [
    '同题 · 讨论记录',
    '房间：' + state.roomId,
    '导出时间：' + new Date().toLocaleString('zh-CN'),
    '',
  ];
  for (const round of rounds) {
    lines.push('第 ' + round.round + ' 轮：' + round.question.questionText, '');
    for (const answer of round.answers)
      lines.push(answer.nickname + '：', answer.selectedOption, answer.answerText, '');
    lines.push(
      round.result.metric +
        '：' +
        (round.result.similarity === null ? '文字不足' : round.result.similarity + '%'),
      '来源：' + round.result.provider,
      round.result.reason,
      ...round.result.commonGround.map((x) => '共同点：' + x),
      ...round.result.differences.map((x) => '差异：' + x),
      '继续聊：' + round.result.followUp,
      round.result.notice,
      '',
    );
  }
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
  );
  const link = element('a');
  link.href = url;
  link.download = '同题-' + state.roomId + '.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('hashchange', async () => {
  const id = roomFromHash();
  if (session && id === session.roomId) return;
  leave();
  if (id)
    try {
      await previewRoom(id);
    } catch (error) {
      message(error.message);
    }
});
async function init() {
  const data = await api('/api/preset-questions');
  presets = data.questions;
  setupEditor('createEditor');
  setupEditor('nextEditor');
  $('createBtn').disabled = false;
  const id = roomFromHash();
  if (id) await previewRoom(id);
}
init().catch((error) => message(error.message + ' 刷新页面可重试。'));
