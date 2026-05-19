import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexLocalDocsSource } from "../../src/context/localDocsIndexer.js";
import { LocalDocsRepo } from "../../src/storage/localDocsRepo.js";
import { openDatabase } from "../../src/storage/sqlite.js";

describe("local docs context", () => {
  it("indexes and searches markdown docs with SQLite FTS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "signald-docs-"));
    await writeFile(join(dir, "README.md"), "# Payments\nRetry policy uses idempotency keys.");
    await writeFile(join(dir, ".env.secret"), "TOKEN=secret");

    const db = openDatabase(":memory:");
    const result = await indexLocalDocsSource(db, {
      id: "company-docs",
      path: dir,
      repo_id: "payments",
      include: ["**/*.md"],
      exclude: [".env*", "**/*secret*"]
    });

    expect(result.indexed).toBe(1);
    const matches = new LocalDocsRepo(db).search("idempotency retry", 5);
    expect(matches[0]?.repoId).toBe("payments");
    expect(matches[0]?.snippet).toContain("idempotency");
    db.close();
  });
});
