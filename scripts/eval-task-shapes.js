const fs = require("fs");
const path = require("path");
const { detectTaskShape, scoreTaskShape } = require("../lib/task-shapes");

const casesPath = path.join(__dirname, "..", "evals", "task-shapes.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

let passed = 0;
const failures = [];

function sameSet(actual, expected) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

for (const testCase of cases) {
  const detectedShape = detectTaskShape(testCase.input);
  const score = scoreTaskShape(testCase.input, detectedShape);

  const shapeOk = detectedShape === testCase.expectedShape;
  const missingOk = sameSet(score.missing, testCase.missingSlots);
  const readyOk = score.ready === testCase.ready;

  if (shapeOk && missingOk && readyOk) {
    passed++;
    continue;
  }

  failures.push({
    name: testCase.name,
    input: testCase.input,
    expected: {
      shape: testCase.expectedShape,
      missingSlots: testCase.missingSlots,
      ready: testCase.ready
    },
    actual: {
      shape: detectedShape,
      missingSlots: score.missing,
      ready: score.ready,
      score: `${score.score}/${score.maxScore}`
    },
    checks: { shapeOk, missingOk, readyOk }
  });
}

console.log(`Task-shape eval: ${passed}/${cases.length} passed`);

if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((failure, index) => {
    console.log(`\n${index + 1}. ${failure.name}`);
    console.log(`Input: ${failure.input}`);
    console.log("Expected:", failure.expected);
    console.log("Actual:", failure.actual);
    console.log("Checks:", failure.checks);
  });
  process.exitCode = 1;
}
