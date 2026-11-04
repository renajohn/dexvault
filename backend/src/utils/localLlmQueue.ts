/**
 * One model, one request at a time: the album guides, the radio's fiches and
 * its choices all wait their turn here, never beside each other. A request a
 * listener is waiting for (`urgent`) goes before the work queued in the
 * background, though never in the middle of the one running.
 */

type Job = { run: () => void; urgent: boolean };

const waiting: Job[] = [];
let busy = false;

const nextJob = (): void => {
  if (busy) return;
  const job = waiting.shift();
  if (!job) return;
  busy = true;
  job.run();
};

export const inTurn = <T>(work: () => Promise<T>, { urgent = false }: { urgent?: boolean } = {}): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const job: Job = {
      urgent,
      run: () => {
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          busy = false;
          nextJob();
        });
      },
    };
    // After the other urgent ones, before the background work.
    const at = urgent ? waiting.findIndex(one => !one.urgent) : -1;
    if (at === -1) waiting.push(job); else waiting.splice(at, 0, job);
    nextJob();
  });

/** Whether the model is busy or has work waiting. */
export const llmBusy = (): boolean => busy || waiting.length > 0;
