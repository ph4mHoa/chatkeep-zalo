// Archive rules. The archive never loses data: a message that is later recalled, deleted or no
// longer on this device keeps its archived content; an edit keeps the previous text.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeAttachments(oldList = [], incList = []) {
  const byId = new Map(oldList.map(a => [a.id, a]));
  for (const a of incList) byId.set(a.id, { ...(byId.get(a.id) || {}), ...a });
  return [...byId.values()];
}

// Fields that describe what the message holds; the latest sighting wins, a missing one never
// erases an archived one.
const CONTENT = ['styles', 'link', 'cards', 'sticker', 'location', 'contact', 'call'];

export function mergeMessage(old, inc, { runId, now }) {
  if (!old) {
    const record = { ...inc, firstSeenAt: now, lastSeenAt: now, lastSeenRun: runId };
    if (inc.recalled) record.recalledDetectedAt = now;
    return { record, change: 'added' };
  }
  const record = { ...old, lastSeenAt: now, lastSeenRun: runId };
  let changed = false;
  if (old.missingSince) { delete record.missingSince; changed = true; }

  if (inc.recalled) {
    // Recalled ("thu hồi") on Zalo: the archived text and attachments stay.
    if (!old.recalled) { record.recalled = true; record.recalledDetectedAt = now; changed = true; }
  } else {
    if (inc.text != null && inc.text !== old.text) {
      if (old.text != null) record.editHistory = [...(old.editHistory || []), { text: old.text, replacedAt: now }];
      record.text = inc.text;
      changed = true;
    }
    if (inc.attachments && inc.attachments.length) {
      const merged = mergeAttachments(old.attachments, inc.attachments);
      if (!same(merged, old.attachments)) { record.attachments = merged; changed = true; }
    }
    for (const k of CONTENT) if (inc[k] != null && !same(inc[k], old[k])) { record[k] = inc[k]; changed = true; }
    if (inc.type !== old.type && !old.recalled) { record.type = inc.type; record.kind = inc.kind; changed = true; }
  }
  if (inc.replyTo) {
    const merged = { ...(old.replyTo || {}) };
    for (const [k, v] of Object.entries(inc.replyTo)) if (v != null) merged[k] = v;
    if (!same(merged, old.replyTo)) { record.replyTo = merged; changed = true; }
  }
  // A sender archived as "0" (the account itself, before its id was known) gets the real id.
  if (inc.senderId && inc.senderId !== '0' && inc.senderId !== old.senderId) { record.senderId = inc.senderId; changed = true; }
  for (const k of ['senderName', 'mentions', 'isForwarded', 'ttl']) {
    if (inc[k] != null && !same(inc[k], old[k])) { record[k] = inc[k]; changed = true; }
  }
  return { record, change: changed ? 'updated' : 'same' };
}

// Coverage: sorted, disjoint [from, to] timestamp intervals in which every message this device
// had was captured.
export function addInterval(coverage, [from, to]) {
  const all = [...(coverage || []).map(c => [...c]), [from, to]].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// The covered interval that contains `ts`, or null. A read coming down from the newest message
// skips from inside an interval to its lower end.
export function intervalAt(coverage, ts) {
  for (const iv of coverage || []) if (iv[0] <= ts && ts <= iv[1]) return iv;
  return null;
}
