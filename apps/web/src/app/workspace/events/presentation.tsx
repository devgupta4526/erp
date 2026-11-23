import Link from "next/link";

const messages: Record<string, string> = {
  done: "Event records updated.",
  forbidden: "Your workspace, role, or subscription does not allow this action.",
  invalid: "Check the details and try again.",
  duplicate: "This venue or guest already exists.",
  "venue-capacity": "Select a venue that can accommodate this event.",
  "schedule-window": "Set a valid session within the event’s time window.",
  overlap: "The venue or event schedule is already booked during that time.",
  full: "This event has reached its confirmed guest capacity.",
  unavailable: "The record has changed or this event is canceled.",
};

export function EventFeedback({ result }: { result?: string }) {
  return result && Object.hasOwn(messages, result) ? <p className="notice" role="status">{messages[result]}</p> : null;
}

export const maxPage = 10000;

export function eventPage(raw: string | undefined) {
  const value = Number(raw ?? 1);
  return Number.isSafeInteger(value) && value > 0 && value <= maxPage ? value : 1;
}

export function EventPages({ page, next, label }: { page: number; next: boolean; label: string }) {
  return page > 1 || next ? <nav className="pagination" aria-label={label}>
    {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
    <span>Page {page}</span>
    {next && page < maxPage && <Link href={`?page=${page + 1}`}>Next</Link>}
  </nav> : null;
}

const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function eventTime(value: string) {
  return <time dateTime={value}>{formatter.format(new Date(value))}</time>;
}
