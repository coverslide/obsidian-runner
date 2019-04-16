const path = require('path');
const Koa = require('koa');
const KoaRouter = require('koa-trie-router');
const fs = require('fs');
const { TaskRunner } = require('./util');

const fsp = fs.promises;

const port = process.env.PORT || 8080;
const obligeRoot = process.env.OBLIGE_ROOT || __dirname + '/oblige';
const fileRoot = process.env.FILE_ROOT || __dirname + '/output';
const configPath = process.env.CONFIG_PATH;

let config = {};
if (configPath) {
  config = require(configPath);
}

const taskRunner = new TaskRunner(fileRoot, obligeRoot, config);

fs.access(fileRoot, (err) => {
  if (err) {
    throw err;
  }
})

const app = new Koa();

app.proxy = true;

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.trace(err);
    ctx.body = ""+err;
  }
});

const router = new KoaRouter();

router.get('/', async (ctx, next) => {
  ctx.status = 302;
  ctx.set('location', '/all');
});

router.get('/new', async (ctx, next) => {
  const id = TaskRunner.newId();

  const task = taskRunner.get(id);

  await task.init(ctx.query);

  ctx.body = id;
  ctx.status = 302;
  ctx.set('location', '/task/' + id);

  taskRunner.checkTasks();
});

router.get('/all', async (ctx, next) => {
  const tasks = await fsp.readdir(fileRoot);
  const all = {};
  tasks.sort()
  const limit = +ctx.query.limit || 100;
  const offset = +ctx.query.offset || 0;
  const selectedTasks = tasks.reverse().slice(offset, limit + offset);
  for (id of selectedTasks) {
    const task = taskRunner.get(id);
    const status = await task.getFile('status.json');
    const date = new Date(parseInt(id.slice(0, 8), 36)).toISOString();
    all[id] = { date, status, url: `${ctx.request.protocol}://${ctx.request.host}/task/${id}` };
  };

  ctx.body = all;
});

router.get('/task/:id', async (ctx, next) => {
  const id = ctx.params.id;
  const task = taskRunner.get(id);
  const params = await task.getFile('params.json');
  const status = await task.getFile('status.json');

  const files = {};

  if (status.state == 'done' || status.state == 'running' || status.state == 'error') {
    files.log = `${ctx.request.protocol}://${ctx.request.host}/task/${id}/log`;
  }

  if (status.state == 'done') {
    files.wad = `${ctx.request.protocol}://${ctx.request.host}/task/${id}/wad`;
  }

  ctx.body = { params, status, files };
});

router.get('/task/:id/log', async (ctx, next) => {
  const task = taskRunner.get(ctx.params.id);
  ctx.type = 'text/plain';
  ctx.body = task.streamFile('run.log');
});

router.get('/task/:id/params', async (ctx, next) => {
  const task = taskRunner.get(ctx.params.id);
  ctx.type = 'text/plain';
  ctx.body = task.streamFile('params.json');
});

router.get('/task/:id/retry', async (ctx, next) => {
  const id = ctx.params.id;
  const task = taskRunner.get(id);
  await task.retry();

  ctx.status = 302;
  ctx.set('location', '/task/' + id);

  taskRunner.checkTasks();
});

router.get('/task/:id/wad', async (ctx, next) => {
  const task = taskRunner.get(ctx.params.id);
  const status = await task.getFile('status.json');
  ctx.set('Content-Disposition', `attachment;filename="${status.title}.wad"`)
  ctx.body = task.streamFile('output.wad');
});

app.use(router.middleware());

taskRunner.checkTasks();

app.listen(port);
