/** A simulation clock anchored to monotonic elapsed time, independent of timer cadence. */
export class SimulationClock {
  constructor(
    private simulatedMilliseconds: number,
    private monotonicMilliseconds: number,
    private rate = 0,
  ) {}

  getTime(monotonicNow: number): number {
    return this.simulatedMilliseconds + Math.max(0, monotonicNow - this.monotonicMilliseconds) * this.rate;
  }

  /** Tick the readout once per real second; sky motion still uses continuous getTime. */
  getDisplayTime(monotonicNow: number): number {
    const elapsedSeconds = Math.floor(Math.max(0, monotonicNow - this.monotonicMilliseconds) / 1000);
    return this.simulatedMilliseconds + elapsedSeconds * 1000 * this.rate;
  }

  setRate(rate: number, monotonicNow: number): number {
    this.simulatedMilliseconds = this.getTime(monotonicNow);
    this.monotonicMilliseconds = monotonicNow;
    this.rate = rate;
    return this.simulatedMilliseconds;
  }

  setTime(simulatedMilliseconds: number, monotonicNow: number, rate = 0): number {
    this.simulatedMilliseconds = simulatedMilliseconds;
    this.monotonicMilliseconds = monotonicNow;
    this.rate = rate;
    return this.simulatedMilliseconds;
  }
}
