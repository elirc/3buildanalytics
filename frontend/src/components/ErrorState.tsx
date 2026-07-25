import { ApiError } from "../api/client";

/**
 * Turns a thrown error into something a user can act on.
 *
 * A 403 is not a failure the user can retry their way out of — it is an answer.
 * Showing "Insufficient permissions" next to a Try again button trains people
 * to mash the button. So the copy and the affordances both branch on the code.
 */
function describe(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "FORBIDDEN":
        return {
          title: "You don't have access to this data",
          detail: "Your role doesn't include permission to view it. Ask an administrator if you need it.",
          canRetry: false
        };
      case "UNAUTHORIZED":
        return {
          title: "Your session has expired",
          detail: "Sign in again to continue.",
          canRetry: false
        };
      case "RATE_LIMITED":
        return {
          title: "Too many requests",
          detail: "You've hit the rate limit. Wait a moment and try again.",
          canRetry: true
        };
      case "BAD_REQUEST":
        return { title: "That request wasn't valid", detail: error.message, canRetry: false };
      case "NOT_FOUND":
        return { title: "Not found", detail: error.message, canRetry: false };
      default:
        return {
          title: "Something went wrong",
          detail: error.requestId ? `${error.message} (reference: ${error.requestId})` : error.message,
          canRetry: true
        };
    }
  }

  const message = error instanceof Error ? error.message : fallback;
  return { title: "Something went wrong", detail: message, canRetry: true };
}

export function ErrorState({
  message,
  error,
  onRetry
}: {
  /** Used when no error object is available, or as a fallback message. */
  message?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const { title, detail, canRetry } = describe(error, message ?? "Something went wrong");

  return (
    <div
      role="alert"
      className="rounded-3xl border border-[var(--danger)]/30 bg-red-50 p-6 text-sm text-[var(--danger)]"
    >
      <p className="font-medium">{title}</p>
      {detail && detail !== title ? <p className="mt-1 opacity-90">{detail}</p> : null}
      {onRetry && canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-2xl border border-[var(--danger)]/40 px-4 py-2 font-medium transition hover:bg-red-100"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
