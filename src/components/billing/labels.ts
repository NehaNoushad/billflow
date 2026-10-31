export const METHOD_LABELS: Record<string, string> = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", UPI: "UPI", CARD: "Card", OTHER: "Other" };

export function methodLabel(method: string) {
  return METHOD_LABELS[method] ?? method;
}
