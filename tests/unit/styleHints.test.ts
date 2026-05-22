import { describe, expect, it } from "vitest";
import { extractStyleHint } from "../../src/core/styleHints.js";
import { StyleHintsRepo } from "../../src/storage/styleHintsRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";

describe("style hints", () => {
  it("extracts non-sensitive style notes from draft edits", () => {
    const hint = extractStyleHint({
      before: "I can look into this. I think it is safe.",
      after: "I can look into this, but I need the rollout link before I can say it is safe."
    });

    expect(hint).toContain("adds uncertainty");
    expect(hint).not.toContain("rollout link");
  });

  it("stores style hints without raw draft content", () => {
    const db = openDatabase(":memory:");
    const repo = new StyleHintsRepo(db);

    repo.record({
      draftId: "draft-1",
      hint: "User prefers explicit uncertainty for deployment replies.",
      source: "edited_draft"
    });

    expect(repo.list()).toEqual([
      expect.objectContaining({
        draftId: "draft-1",
        hint: "User prefers explicit uncertainty for deployment replies.",
        source: "edited_draft"
      })
    ]);
  });
});
