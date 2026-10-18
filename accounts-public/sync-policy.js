export class PollBudget {
  constructor(clock = () => Date.now()) { this.clock = clock; this.reset(); }
  reset() { this.delay = 30000; this.nextAt = 0; }
  due() { return this.clock() >= this.nextAt; }
  completed(unchanged = false, failed = false) { this.delay = failed ? Math.min(300000, this.delay * 2) : unchanged ? Math.min(120000, this.delay * 2) : 30000; this.nextAt = this.clock() + this.delay; }
}
