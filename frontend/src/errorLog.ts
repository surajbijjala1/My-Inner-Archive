/**
 * Last-resort logging for errors nothing else caught. Console only — there is
 * no reporting service, and nothing leaves the device.
 *
 * Only the error's name, message and stack are logged: never component props,
 * state, request bodies or anything else that could hold journal text.
 */

function describe(reason: unknown): string {
  if (reason instanceof Error) {
    const head = `${reason.name}: ${reason.message}`;
    // Chromium's stack already opens with that line; Safari's and Firefox's don't.
    if (!reason.stack) return head;
    return reason.stack.startsWith(head) ? reason.stack : `${head}\n${reason.stack}`;
  }
  // A rejection can carry any value; only its type is safe to print.
  return `non-Error value of type ${typeof reason}`;
}

/** Called by the error boundaries. `where` names the area, never its content. */
export function logCrash(where: string, error: unknown, componentStack?: string | null): void {
  console.error(`[archive] ${where} failed to render — ${describe(error)}${componentStack ?? ""}`);
}

let installed = false;

/** Install once, before the first render. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    // Resource load failures (an image, a font) also arrive here, without an error.
    if (!event.error) return;
    console.error(`[archive] uncaught error — ${describe(event.error)}`);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error(`[archive] unhandled promise rejection — ${describe(event.reason)}`);
  });
}
