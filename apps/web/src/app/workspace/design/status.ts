const statuses: Record<string, string> = {
  created: "Design project created.",
  saved: "Layer updated.",
  invalid: "Check the design details. Layers must fit inside the canvas.",
  missing: "This project is unavailable.",
  stale: "The layer or its order changed. Review the current layers and try again.",
  limit: "A design can contain up to 70 layers.",
  forbidden: "Your workspace, role or subscription does not allow this action.",
};

export function designStatus(code?: string) {
  return code && Object.hasOwn(statuses, code) ? statuses[code] : undefined;
}
