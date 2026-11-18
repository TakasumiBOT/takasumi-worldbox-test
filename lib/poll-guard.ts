export type PollTicket = number;

export function createPollGuard() {
  let seq = 0;
  let inFlight = false;
  return {
    begin(opts?: { force?: boolean }): PollTicket | null {
      if (inFlight && !opts?.force) return null;
      inFlight = true;
      seq += 1;
      return seq;
    },
    isCurrent(ticket: PollTicket): boolean {
      return ticket === seq;
    },
    end(ticket: PollTicket): void {
      if (ticket === seq) inFlight = false;
    },
  };
}

export type PollGuard = ReturnType<typeof createPollGuard>;
