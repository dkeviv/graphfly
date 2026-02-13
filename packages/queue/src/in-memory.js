export class InMemoryQueue {
  constructor(name) {
    this.name = name;
    this._jobs = [];
  }

  add(jobName, payload) {
    const job = { id: `${this.name}:${this._jobs.length + 1}`, name: jobName, payload };
    this._jobs.push(job);
    return job;
  }

  drain() {
    const items = this._jobs;
    this._jobs = [];
    return items;
  }
}

