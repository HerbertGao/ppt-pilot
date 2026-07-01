import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntityName, validateEntity } from "../dist/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesRoot = join(packageRoot, "fixtures");
const failures = [];
let checked = 0;

function fixtureFiles(relativeDirectory) {
  const directory = join(fixturesRoot, relativeDirectory);

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

function readFixture(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function displayPath(filePath) {
  return relative(packageRoot, filePath);
}

function validateEnvelope(fixture, filePath) {
  if (typeof fixture !== "object" || fixture === null || Array.isArray(fixture)) {
    failures.push(`${displayPath(filePath)} $ must be a fixture object`);
    return undefined;
  }

  if (typeof fixture.entity !== "string" || !isEntityName(fixture.entity)) {
    failures.push(`${displayPath(filePath)} $.entity must be one of the shared-schema entity names`);
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(fixture, "data")) {
    failures.push(`${displayPath(filePath)} $.data is required`);
    return undefined;
  }

  return fixture;
}

function checkExpectedNormalization(fixture, filePath, data) {
  const expectedStyleProfileId = fixture.expect?.normalized?.styleProfileId;

  if (expectedStyleProfileId === undefined) {
    return;
  }

  if (data?.styleProfileId !== expectedStyleProfileId) {
    failures.push(
      `${displayPath(filePath)} $.styleProfileId expected normalized value "${expectedStyleProfileId}", got "${data?.styleProfileId}"`,
    );
  }
}

function checkExpectedErrors(fixture, filePath, errors) {
  const expectedErrors = fixture.expect?.errors;

  if (expectedErrors === undefined) {
    return;
  }

  const matched = expectedErrors.some((expectedError) =>
    errors.some((error) => {
      const pathMatched =
        typeof expectedError.pathIncludes === "string" && error.path.includes(expectedError.pathIncludes);
      const messageMatched =
        typeof expectedError.messageIncludes === "string" && error.message.includes(expectedError.messageIncludes);

      return pathMatched || messageMatched;
    }),
  );

  if (!matched) {
    const expected = expectedErrors
      .map((item) => item.pathIncludes ?? item.messageIncludes)
      .filter((item) => typeof item === "string")
      .join("; ");

    failures.push(`${displayPath(filePath)} expected invalid error matching: ${expected}`);
  }
}

function checkSuccessDirectory(relativeDirectory, label) {
  for (const filePath of fixtureFiles(relativeDirectory)) {
    checked += 1;
    const fixture = validateEnvelope(readFixture(filePath), filePath);

    if (fixture === undefined) {
      continue;
    }

    const result = validateEntity(fixture.entity, fixture.data);

    if (!result.success) {
      failures.push(
        `${displayPath(filePath)} expected ${label} success, got errors: ${result.errors
          .map((item) => `${item.path} ${item.message}`)
          .join("; ")}`,
      );
      continue;
    }

    checkExpectedNormalization(fixture, filePath, result.data);
  }
}

function checkInvalidDirectory(relativeDirectory) {
  for (const filePath of fixtureFiles(relativeDirectory)) {
    checked += 1;
    const fixture = validateEnvelope(readFixture(filePath), filePath);

    if (fixture === undefined) {
      continue;
    }

    if (fixture.phase === "later-phase reference" || fixture.gating === false) {
      failures.push(`${displayPath(filePath)} later-phase reference fixtures must not live under fixtures/invalid`);
      continue;
    }

    const result = validateEntity(fixture.entity, fixture.data);

    if (result.success) {
      failures.push(`${displayPath(filePath)} expected Phase 1 gating failure, but validation passed`);
      continue;
    }

    checkExpectedErrors(fixture, filePath, result.errors);
  }
}

checkSuccessDirectory("valid", "valid fixture");
checkSuccessDirectory("defaults", "default profile fixture");
checkInvalidDirectory("invalid");

if (failures.length > 0) {
  console.error("shared-schema fixture validation failed:");

  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  process.exitCode = 1;
} else {
  console.log(`shared-schema fixtures validated: ${checked} fixture expectations passed`);
}
