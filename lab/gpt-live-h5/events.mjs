/** Display only provider transcript text; other wire fields stay off the page. */
export function transcriptEvent(event) {
  const type = event?.type;
  if (type === "turn.done") {
    const turn = event.turn;
    if (["user", "assistant"].includes(turn?.role) && typeof turn.transcript === "string") {
      return { role: turn.role, id: turn.id, text: turn.transcript, final: true };
    }
    return null;
  }
  const role = /^(session\.)?input_transcript\./u.test(type ?? "") ? "user"
    : /^(session\.)?output_transcript\./u.test(type ?? "") ? "assistant" : null;
  if (!role) return null;
  const value = event.delta ?? event.item ?? event;
  const text = typeof value === "string" ? value
    : Array.isArray(value) ? value.map((item) => item?.text ?? "").join("")
    : value?.text ?? value?.transcript ?? event.text ?? "";
  if (typeof text !== "string" || !text) return null;
  return { role, id: event.turn_id ?? event.item_id ?? value?.id, text, final: type.endsWith(".done") };
}
