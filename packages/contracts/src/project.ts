import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const SSH_HOST_ALIAS_MAX_LENGTH = 255;

export const PosixAbsolutePath = TrimmedNonEmptyString.check(Schema.isPattern(/^\//));
export type PosixAbsolutePath = typeof PosixAbsolutePath.Type;

export const SshHostAlias = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SSH_HOST_ALIAS_MAX_LENGTH),
);
export type SshHostAlias = typeof SshHostAlias.Type;

export const LocalProjectLocation = Schema.Struct({
  kind: Schema.Literal("local"),
  rootPath: TrimmedNonEmptyString,
});
export type LocalProjectLocation = typeof LocalProjectLocation.Type;

export const SshProjectLocation = Schema.Struct({
  kind: Schema.Literal("ssh"),
  hostAlias: SshHostAlias,
  rootPath: PosixAbsolutePath,
});
export type SshProjectLocation = typeof SshProjectLocation.Type;

export const ProjectLocation = Schema.Union([LocalProjectLocation, SshProjectLocation]);
export type ProjectLocation = typeof ProjectLocation.Type;

export const ProjectValidateSshTargetInput = Schema.Struct({
  hostAlias: SshHostAlias,
  rootPath: PosixAbsolutePath,
});
export type ProjectValidateSshTargetInput = typeof ProjectValidateSshTargetInput.Type;

export const ProjectValidateSshTargetResult = Schema.Struct({
  hostAlias: SshHostAlias,
  rootPath: PosixAbsolutePath,
  codexInstalledBy: Schema.optional(Schema.Literals(["bun", "npm"])),
  codexAuthStatus: Schema.optional(Schema.Literals(["authenticated", "unauthenticated", "unknown"])),
  codexAuthMessage: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectValidateSshTargetResult = typeof ProjectValidateSshTargetResult.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;
