import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Profile } from "../components/Profile";
import { ExtractionWarnings } from "../components/ExtractionWarnings";
import { syntheticProfile } from "./fixtures";

describe("Profile presentation", () => {
  it("highlights unrecognized month data without requiring expansion", () => {
    render(
      <ExtractionWarnings
        metadata={{
          ...syntheticProfile.parsing_metadata,
          warnings: [
            "Unrecognized experience month expression omitted; review the source.",
          ],
        }}
      />,
    );
    expect(
      screen.getAllByText(
        "Unrecognized experience month expression omitted; review the source.",
      )[0],
    ).toBeVisible();
    expect(screen.getByText(/1 needing attention/)).toBeInTheDocument();
  });
  it("summarizes and deduplicates warnings, with accessible expansion and collapse", () => {
    render(
      <ExtractionWarnings
        metadata={{
          ...syntheticProfile.parsing_metadata,
          warnings: [
            "Missing education.",
            " missing   education!",
            "Ambiguous dates; review required.",
            "Skills are mentions only.",
          ],
        }}
      />,
    );
    expect(screen.getByText(/3 review notes/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Show all warnings" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Missing education.")).not.toBeVisible();
    expect(
      screen.getAllByText("Ambiguous dates; review required.")[0],
    ).toBeVisible();
    fireEvent.click(button);
    expect(screen.getByText("Missing education.")).toBeVisible();
    expect(screen.getByText("Skill limitations")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Hide warnings" }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide warnings" }));
    expect(screen.getByText("Missing education.")).not.toBeVisible();
  });
  it("renders complete roles, locations, projects and independent profile columns", () => {
    const result = structuredClone(syntheticProfile);
    result.candidate.experience[0].job_title =
      "Stagiaire PFE – Intelligence Artificielle & GraphRAG";
    result.candidate.experience[0].location = "Maroc";
    result.candidate.technical_skills.push({
      name: "HTML",
      category: "web_technology",
    });
    render(<Profile result={result} />);
    expect(
      screen.getByText("Stagiaire PFE – Intelligence Artificielle & GraphRAG"),
    ).toBeInTheDocument();
    expect(screen.getByText("Maroc")).toBeInTheDocument();
    expect(screen.getByText("Demo project")).toBeInTheDocument();
    expect(document.querySelectorAll(".profile-column")).toHaveLength(2);
    expect(screen.getByText("web technology")).toBeInTheDocument();
  });
});
