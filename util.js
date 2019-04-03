const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { promisify } = require('util');
const fsp = fs.promises;

const DEFAULT_PARAMS = { length: "single", game: "doom2", engine: "gzdoom" };

class Task {
  constructor (id, fileRoot) {
    this.id = id;
    this.fileRoot = fileRoot;
  }

  get taskRoot () {
    return path.join(this.fileRoot, this.id);
  }

  getPath (filename) {
    return path.join(this.taskRoot, filename);
  }

  async checkStat (filename) {
    return await checkStat(this.getPath(filename));
  }

  async setFile (filename, data) {
    return await setFile(this.getPath(filename), data);
  }

  async getFile (filename) {
    return await getFile(this.getPath(filename));
  }

  async getRawFile (filename) {
    return await fsp.readFile(this.getPath(filename), 'utf8');
  }

  async removeFile (filename) {
    return await fsp.unlink(this.getPath(filename));
  }

  streamFile (filename) {
    return fs.createReadStream(this.getPath(filename));
  }

  static checkFinished (log) {
    return log.match(/====== END OF OBLIGE LOGS ======/);
  }

  static parseTitle (log) {
    const lines = log.split(/\n/g);
    const titleLine = lines.find(l => l.match(/^Game title:/));
    if (titleLine) {
      return titleLine.split(/:\s*/)[1];
    }
  }

  async init (params) {
    await fsp.mkdir(this.taskRoot);

    const realParams = { ...DEFAULT_PARAMS, ...params };
    await this.setFile("params.json", realParams);

    const status = { state: "pending" };
    await this.setFile("status.json", status);
  }

  async retry () {
    await this.setFile("status.json", { state: 'pending' });
    const wadStat = await this.checkStat("output.wad");
    if (wadStat) {
      await this.removeFile("output.wad");
    }
  }

  async validateStatus () {
    const status = await this.getFile('status.json');
    if (status.state != 'done') {
      const wadStat = await this.checkStat('output.wad');
      const log = await this.getRawFile('run.log');
      const isFinished = Task.checkFinished(log);
      if (!isFinished) {
        await this.setFile('status.json', { state: 'pending'});
        return;
      }
      const title = Task.parseTitle(log);
      if (!title) {
        await this.setFile('status.json', { state: 'pending'});
      }
      await this.setFile('status.json', { state: 'done', title });
    }
  }
}

class TaskRunner {
  constructor (fileRoot, obligeRoot) {
    this.obligeRoot = obligeRoot;
    this.fileRoot = fileRoot;
  }

  static newId () {
    return (Date.now().toString(36).padStart(8, '0') + Math.random().toString(36).slice(2).padEnd(11, '0'));
  }

  get (id) {
    const task = new Task(id, this.fileRoot);
    return task;
  }

  async checkTasks () {
    if (this.running) {
      console.warn('Already running');
    }
    if (this.defer) {
      await this.defer.promise;
    }
    this.defer = defer();

    try {
      const tasks = await fsp.readdir(this.fileRoot);

      tasks.sort();

      let queueSize = this.running ? 1 : 0;
      for (const id of tasks) {
        const task = this.get(id);
        const status = await task.getFile('status.json');

        if (status.state == "done") {
          continue;
        }
        if (status.state == 'error') {
          continue;
        }
        if (status.state == 'running') {
          if (this.running == id) {
            continue;
          }
          task.validateStatus()
        }

        if (status.state == 'pending') {
          if (queueSize == 0 && !this.running) {
            this.running = id;
            this.runTask(id);
          } else {
            await task.setFile("status.json", { state: 'pending', queue: queueSize });
          }

          queueSize += 1;
        }
      }
    } catch (err) {
      console.trace(err);
    } finally {
      this.defer.resolve();
      this.defer = null;
    }
  }

  async runTask (id) {
    const task = this.get(id);
    const params = await task.getFile('params.json');

    const args = [
      '--batch', task.getPath('output.wad'),
      '--log', task.getPath('run.log'),
      '--home', this.obligeRoot,
      '--install', this.obligeRoot,
    ].concat(Object.entries(params).map(([k, v]) => `${k}=${v}`));

    const taskProcess = promisify(cp.execFile)(this.obligeRoot + '/Oblige', args);

    try {
      await task.setFile('status.json', { state: 'running' });
      const done = await taskProcess;
      await task.validateStatus();
    } catch (err) {
      console.trace(err);
      await task.setFile('status.json', { state: 'error', error: err });
    } finally {
      this.running = null;
      this.checkTasks();
    }
  }
}

const checkStat = async (filename) => {
  try {
    return await fsp.stat(filename);
    return true;
  } catch (err) {
    return false;
  }
}

const setFile = async (filename, data) => {
  const output = await stringifyJSON(data);
  // truncate, because writeFile isn't reliable
  if (await checkStat(filename)) {
    await fsp.truncate(filename);
  }
  return await fsp.writeFile(filename, output, 'utf8');
}

const getFile = async (filename) => {
  const output = await fsp.readFile(filename);
  try {
    const data = await parseJSON(output);
    return data;
  } catch (err) {
    throw new Error(`Error parsing ${filename}: ${err.message}`);
  }
}

const parseJSON = (data) => new Promise((resolve, reject) => {
  try {
    resolve(JSON.parse(data));
  } catch (err) {
    reject(err);
  }
});

const stringifyJSON = (data) => new Promise((resolve, reject) => {
  try {
    resolve(JSON.stringify(data));
  } catch (err) {
    reject(err);
  }
});

const defer = () => {
  const d = {};

  d.promise = new Promise((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });

  return d;
}

exports.Task = Task;
exports.TaskRunner = TaskRunner;
