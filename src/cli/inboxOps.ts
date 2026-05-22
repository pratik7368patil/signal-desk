import { AttentionRepo } from "../storage/attentionRepo.js";
import { openDatabase } from "../storage/sqlite.js";

export function listInbox(options: { json?: boolean; limit?: number } = {}): void {
  const db = openDatabase();
  try {
    const items = new AttentionRepo(db).list({ limit: options.limit ?? 50 });
    if (options.json) {
      console.log(JSON.stringify({ items }, null, 2));
      return;
    }
    if (items.length === 0) {
      console.log("Inbox is empty.");
      return;
    }
    for (const item of items) {
      console.log(`${item.id}\t${item.priority}\t${item.state}\t${item.category}\t${item.title}\t${item.summary}`);
    }
  } finally {
    db.close();
  }
}

export function showInboxItem(id: string, options: { json?: boolean } = {}): void {
  const db = openDatabase();
  try {
    const item = new AttentionRepo(db).get(id);
    if (!item) {
      throw new Error(`Inbox item not found: ${id}`);
    }
    if (options.json) {
      console.log(JSON.stringify(item, null, 2));
      return;
    }
    console.log(`${item.title}`);
    console.log(`priority=${item.priority} state=${item.state} category=${item.category}`);
    console.log(item.summary);
    console.log(`channel=${item.channel} thread_ts=${item.threadTs}`);
    if (item.draftId) {
      console.log(`draft=${item.draftId}`);
    }
    if (item.reasons.length > 0) {
      console.log(`reasons=${item.reasons.join(",")}`);
    }
  } finally {
    db.close();
  }
}

export function dismissInboxItem(id: string): void {
  const db = openDatabase();
  try {
    new AttentionRepo(db).dismiss(id);
    console.log(`Dismissed ${id}`);
  } finally {
    db.close();
  }
}

export function snoozeInboxItem(id: string, until: string): void {
  const db = openDatabase();
  try {
    new AttentionRepo(db).snooze(id, normalizeUntil(until));
    console.log(`Snoozed ${id} until ${normalizeUntil(until)}`);
  } finally {
    db.close();
  }
}

export function draftInboxItem(id: string): void {
  const db = openDatabase();
  try {
    const item = new AttentionRepo(db).get(id);
    if (!item) {
      throw new Error(`Inbox item not found: ${id}`);
    }
    if (item.draftId) {
      console.log(`Draft already exists: ${item.draftId}`);
      return;
    }
    console.log("Draft creation from stored inbox items requires the original Slack event. Mention SignalDesk again or use the Slack shortcut for now.");
  } finally {
    db.close();
  }
}

function normalizeUntil(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid snooze time: ${value}`);
  }
  return date.toISOString();
}
