import { assert, describe, it } from "@effect/vitest"
import { parseCapabilityVerificationOptions } from "./CapabilityVerification.ts"

describe("capability verification options", () => {
  it("keeps the existing command on the host profile", () => {
    assert.deepEqual(parseCapabilityVerificationOptions(["network"]), {
      ok: true,
      options: { capabilityId: "network", profile: "host" },
    })
  })

  it("accepts the explicit host profile before or after the capability", () => {
    assert.deepEqual(parseCapabilityVerificationOptions(["network", "--profile", "host"]), {
      ok: true,
      options: { capabilityId: "network", profile: "host" },
    })
    assert.deepEqual(parseCapabilityVerificationOptions(["--profile=host", "network"]), {
      ok: true,
      options: { capabilityId: "network", profile: "host" },
    })
  })

  it("accepts retained-evidence profiles", () => {
    assert.deepEqual(parseCapabilityVerificationOptions(["network", "--profile", "promotion"]), {
      ok: true,
      options: { capabilityId: "network", profile: "promotion" },
    })
    assert.deepEqual(parseCapabilityVerificationOptions(["--profile=integration", "network"]), {
      ok: true,
      options: { capabilityId: "network", profile: "integration" },
    })
  })

  it("rejects unsupported profiles and ambiguous input", () => {
    assert.strictEqual(
      parseCapabilityVerificationOptions(["network", "--profile", "release"]).ok,
      false,
    )
    assert.strictEqual(parseCapabilityVerificationOptions([]).ok, false)
    assert.strictEqual(parseCapabilityVerificationOptions(["network", "battery"]).ok, false)
    assert.strictEqual(
      parseCapabilityVerificationOptions(["network", "--profile", "host", "--profile=host"]).ok,
      false,
    )
  })
})
