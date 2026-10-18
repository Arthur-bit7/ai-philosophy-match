const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
test('friends join, reveal answers, restore session, export and continue with a custom question', async ({
  browser,
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /创建双人房间/ })).toBeEnabled();
  await expect(page.getByRole('heading', { name: /我们有多相似/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await page.getByLabel('你的昵称').fill('阿哲');
  await page.getByRole('button', { name: /创建双人房间/ }).click();
  await expect(page.locator('#room')).toBeVisible();
  const invite = page.url();
  await page.getByLabel('优先市场自由', { exact: true }).check();
  await page.locator('#answerText').fill('自由是创新的前提，但也需要保障基本生活。');
  await page.getByRole('button', { name: /提交我的回答/ }).click();
  await expect(page.getByRole('button', { name: /已提交/ })).toBeDisabled();

  const guestContext = await browser.newContext(testInfo.project.use);
  const guest = await guestContext.newPage();
  guest.on('pageerror', (error) => errors.push(error.message));
  try {
    await guest.goto(invite);
    await expect(guest.getByRole('button', { name: '加入对话' })).toBeVisible();
    await guest.getByLabel('你的昵称').fill('小林');
    await guest.getByRole('button', { name: '加入对话' }).click();
    await expect(guest.locator('#room')).toBeVisible();
    await expect(guest.locator('#resultSection')).toBeHidden();
    await expect(guest.locator('body')).not.toContainText('自由是创新的前提');
    await guest.getByLabel('优先社会福利', { exact: true }).check();
    await guest.locator('#answerText').fill('基本生活是自由的前提，我更关注公平的机会。');
    await guest.getByRole('button', { name: /提交我的回答/ }).click();
    await expect(page.locator('#resultSection')).toBeVisible();
    await expect(guest.locator('#resultSection')).toBeVisible();
    await expect(page.locator('#metric')).toContainText('词语重合度');
    await expect(page.locator('#answerComparison')).toContainText('小林');
    await expect(page.locator('#differences')).toContainText('不同选项');
    await expect(guest.locator('#nextSection')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('result.png'), fullPage: true });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载讨论记录/ }).click();
    const download = await downloadEvent;
    const exported = await fs.readFile(await download.path(), 'utf8');
    expect(exported).toContain('自由是创新的前提');
    expect(exported).toContain('小林');
    expect(exported).not.toContain('Bearer');

    await page.reload();
    await expect(page.locator('#resultSection')).toBeVisible();
    await expect(page.getByRole('button', { name: /已提交/ })).toBeDisabled();
    const next = page.locator('#nextEditor');
    await next.getByRole('combobox').selectOption('custom');
    await next.locator('.custom-question').fill('什么是幸福？<script>alert(1)</script>');
    await page.getByRole('button', { name: /开始下一轮/ }).click();
    await expect(guest.locator('#roundBadge')).toHaveText('第 2 轮');
    await expect(page.locator('#history')).toContainText('第 1 轮');
    await expect(guest.locator('#questionTitle')).toHaveText(
      '什么是幸福？<script>alert(1)</script>',
    );
    await expect(guest.locator('#answerText')).toHaveValue('');
    await expect(page.locator('#resultSection')).toBeHidden();
    await expect(page.getByRole('button', { name: /提交我的回答/ })).toBeEnabled();
    await page.locator('#answerText').fill('和朋友真诚地聊天。');
    await guest.locator('#answerText').fill('能自由地生活。');
    await Promise.all([
      page.getByRole('button', { name: /提交我的回答/ }).click(),
      guest.getByRole('button', { name: /提交我的回答/ }).click(),
    ]);
    await expect(page.locator('#resultSection')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});
test('network interruption preserves a draft and resumes polling', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('你的昵称').fill('断线测试');
  await page.getByRole('button', { name: /创建双人房间/ }).click();
  await expect(page.locator('#room')).toBeVisible();
  await page.locator('#answerText').fill('这段草稿不能丢失。');
  await page.route('**/api/rooms/*', (route) => route.abort());
  await expect(page.locator('#message')).toContainText('自动重连');
  await expect(page.locator('#answerText')).toHaveValue('这段草稿不能丢失。');
  await page.unroute('**/api/rooms/*');
  await expect(page.locator('#message')).toBeHidden();
  await expect(page.locator('#answerText')).toHaveValue('这段草稿不能丢失。');
});
test('full room and invalid code show useful messages', async ({ page, request }) => {
  const response = await request.post('/api/rooms', {
    data: { nickname: '甲', question: { questionText: '问题', options: [] } },
  });
  const host = await response.json();
  await request.post('/api/rooms/' + host.roomId + '/join', { data: { nickname: '乙' } });
  await page.goto('/#room=' + host.roomId);
  await expect(page.locator('#previewText')).toContainText('已经有两位');
  await expect(page.getByRole('button', { name: '加入对话' })).toBeDisabled();
  await page.getByLabel('房间号', { exact: true }).fill('BAD');
  await page.getByRole('button', { name: /查看房间/ }).click();
  await expect(page.locator('#message')).toContainText('12 位');
});
