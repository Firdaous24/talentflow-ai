import { describe, expect, it } from "vitest";
import { changedFields, validateReview } from "../review";
import { syntheticProfile } from "./fixtures";
const profile = () => JSON.parse(JSON.stringify(syntheticProfile.candidate));
describe("Review validation", () => {
  it("validates real calendar dates, telephone numbers and allowed profile hosts", () => {
    const candidate = profile();
    expect(validateReview(candidate)).toBeNull();
    candidate.education[0].start_date = "2023-02-29";
    expect(validateReview(candidate)).toMatch(/calendar date/);
    candidate.education[0].start_date = "2024-02-29";
    candidate.phone = "2024";
    expect(validateReview(candidate)).toMatch(/7 to 15/);
    candidate.phone = "+212 612 345 678";
    candidate.github_url = "https://evil.example/user";
    expect(validateReview(candidate)).toMatch(/github.com/);
    candidate.github_url = null;
    candidate.languages[0].name = "";
    expect(validateReview(candidate)).toMatch(/need a name/);
  });
  it("identifies corrections without mutating the original extraction", () => {
    const candidate = profile();
    candidate.full_name = "Reviewed Example";
    candidate.experience = [];
    const fields = changedFields(syntheticProfile.candidate, candidate);
    expect(fields).toContain("full_name");
    expect(fields).toContain("experience.0.job_title");
    expect(syntheticProfile.candidate.full_name).toBe("Alex Example");
  });
});
