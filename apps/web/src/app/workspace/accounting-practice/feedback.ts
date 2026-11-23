const messages: Record<string, string> = {
  done: "Engagement updated.",
  invalid: "Check the details. Task due dates must fall on or before the engagement deadline.",
  forbidden: "This engagement is unavailable in your current workspace or role.",
  limit: "This engagement has reached its limit of 100 tasks.",
  state: "The engagement or task has changed. Review its current status.",
  unfinished: "Complete outstanding tasks before submitting for review.",
  "self-review": "An owner or admin other than the assigned staff member must approve this engagement.",
  uploaded: "Document added.",
  "file-invalid": "Choose a PDF or UTF-8 text file of 512 KB or less.",
  "storage-limit": "This engagement or workspace has reached its document storage limit.",
};

export function practiceFeedback(result?: string) {
  return result && Object.hasOwn(messages, result) ? messages[result] : undefined;
}
