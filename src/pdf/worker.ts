import { Engine } from "./engine";

export type WorkerRequest = { id: number; method: string; args: unknown[] } | { cancel: number };
export type WorkerResponse =
  | { ready: true }
  | { id: number; result: unknown }
  | { id: number; error: string }
  | { id: number; cancelled: true };

const engine = new Engine();
const queue: { id: number; method: string; args: unknown[] }[] = [];
let scheduled = false;

// Las peticiones se encolan y se procesan una por tarea, para que un `cancel` llegue
// antes de que empiece el renderizado de una página que ya no está a la vista.
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if ("cancel" in msg) {
    const i = queue.findIndex((r) => r.id === msg.cancel);
    if (i >= 0) {
      queue.splice(i, 1);
      post({ id: msg.cancel, cancelled: true });
    }
    return;
  }
  queue.push(msg);
  schedule();
};

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(drain, 0);
}

function drain() {
  scheduled = false;
  const req = queue.shift();
  if (!req) return;
  try {
    const fn = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[req.method];
    const result = fn.apply(engine, req.args);
    const transfer = result instanceof Uint8Array
      ? [result.buffer]
      : result && typeof result === "object" && "pixels" in result
        ? [(result as { pixels: Uint8ClampedArray }).pixels.buffer]
        : [];
    post({ id: req.id, result }, transfer as Transferable[]);
  } catch (err) {
    post({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
  if (queue.length) schedule();
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

post({ ready: true });
