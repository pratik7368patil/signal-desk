import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runCommand } from "../utils/shell.js";

export interface CredentialStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class FileCredentialStore implements CredentialStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<string | undefined> {
    const all = await this.readAll();
    return all[key];
  }

  async set(key: string, value: string): Promise<void> {
    const all = await this.readAll();
    all[key] = value;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
    const { chmod } = await import("node:fs/promises");
    await chmod(this.path, 0o600).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    const all = await this.readAll();
    delete all[key];
    if (Object.keys(all).length === 0) {
      await rm(this.path, { force: true });
      return;
    }
    await writeFile(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }
}

export class MacOSKeychainCredentialStore implements CredentialStore {
  constructor(private readonly service = "signald") {}

  async get(key: string): Promise<string | undefined> {
    if (process.platform !== "darwin") {
      return undefined;
    }
    const result = await runCommand("security", ["find-generic-password", "-s", this.service, "-a", key, "-w"], {
      timeoutMs: 5_000
    });
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain is only available on darwin");
    }
    const result = await runCommand("security", ["add-generic-password", "-U", "-s", this.service, "-a", key, "-w", value], {
      timeoutMs: 5_000
    });
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to write macOS Keychain credential");
    }
  }

  async delete(key: string): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }
    await runCommand("security", ["delete-generic-password", "-s", this.service, "-a", key], {
      timeoutMs: 5_000
    });
  }
}

export class CascadingCredentialStore implements CredentialStore {
  constructor(private readonly primary: CredentialStore, private readonly fallback: CredentialStore) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.primary.get(key)) ?? (await this.fallback.get(key));
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.primary.set(key, value);
      await this.fallback.set(key, value);
    } catch {
      await this.fallback.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await Promise.allSettled([this.primary.delete(key), this.fallback.delete(key)]);
  }
}
