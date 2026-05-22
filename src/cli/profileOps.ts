import { readMutableConfig, writeMutableConfig } from "./configOps.js";

export function updateProfile(
  configPath: string,
  input: { role?: string; tone?: string; format?: string; uncertainty?: string; note?: string }
): void {
  const config = readMutableConfig(configPath);
  writeMutableConfig(configPath, {
    ...config,
    profile: {
      ...config.profile,
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.tone === undefined ? {} : { preferred_tone: input.tone }),
      ...(input.uncertainty === undefined ? {} : { default_uncertainty_language: input.uncertainty }),
      writing_style: {
        ...config.profile.writing_style,
        ...(input.format === undefined ? {} : { preferred_format: input.format }),
        notes: input.note === undefined ? config.profile.writing_style.notes : [...config.profile.writing_style.notes, input.note]
      }
    }
  });
}

export function addProfileExample(configPath: string, example: string): void {
  const config = readMutableConfig(configPath);
  writeMutableConfig(configPath, {
    ...config,
    profile: {
      ...config.profile,
      writing_style: {
        ...config.profile.writing_style,
        examples: [...config.profile.writing_style.examples, example]
      }
    }
  });
}
