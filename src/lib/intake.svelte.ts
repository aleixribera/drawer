/**
 * Files and text pasted or dropped anywhere in the app. A page with a composer takes them into it; anywhere else the
 * layout keeps them straight away.
 */
type Take = (files: File[], text: string | null) => void;

let current: Take | null = null;

export function takeIntake(handler: Take): () => void {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

export function intakeHandler(): Take | null {
  return current;
}
