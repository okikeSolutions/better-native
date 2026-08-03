import { assert, describe, it } from "vitest"
import type { BunLock } from "../installation/BunLock.ts"
import { type AuditReport, type ReviewedException, validate } from "./AuditPolicy.ts"

const advisory = {
  url: "https://github.com/advisories/GHSA-test-test-test",
  severity: "high",
  vulnerable_versions: "<2.0.0",
}

const policy: ReadonlyArray<ReviewedException> = [
  {
    owner: { lockKey: "reviewed-owner", identifier: "reviewed-owner@1.0.0" },
    dependency: { lockKey: "reviewed-owner/vulnerable", name: "vulnerable", version: "1.0.0" },
    advisories: ["GHSA-test-test-test"],
  },
]

const lock: BunLock = {
  packages: {
    "reviewed-owner": ["reviewed-owner@1.0.0", "", { dependencies: { vulnerable: "1.0.0" } }],
    "reviewed-owner/vulnerable": ["vulnerable@1.0.0", "", {}],
  },
}

const report: AuditReport = { vulnerable: [advisory] }

describe("dependency audit policy", () => {
  it("accepts only the exact reviewed owner, version, path and advisory", () => {
    assert.deepEqual(validate(report, lock, policy), [])
  })

  it("rejects the same advisory arriving through an additional dependency path", () => {
    const changed: BunLock = {
      packages: {
        ...lock.packages,
        "new-owner/vulnerable": ["vulnerable@1.5.0", "", {}],
      },
    }
    assert.match(validate(report, changed, policy).join("\n"), /new-owner\/vulnerable/)
  })

  it("rejects unreviewed advisories and stale exceptions", () => {
    const unreviewed: AuditReport = {
      vulnerable: [
        advisory,
        {
          ...advisory,
          url: "https://github.com/advisories/GHSA-new-new-new",
        },
      ],
    }
    assert.match(validate(unreviewed, lock, policy).join("\n"), /unreviewed vulnerable/)
    assert.match(validate({}, lock, policy).join("\n"), /stale exception/)
  })
})
