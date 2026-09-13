import { describe, expect, it } from "vitest";
import {
  aggregateBuckets,
  monthStartOf,
  rankAgents,
  splitLegend,
  weekStartOf,
  type CostGranularity,
} from "./aggregation";
import type { CostBucket } from "@/lib/api";

function bucket(day: string, agents: Array<[string, number, string[]?]>): CostBucket {
  const rows = agents.map(([agent, stepCost, models = ["m1"]]) => ({
    agent,
    promptTokens: 10,
    completionTokens: 4,
    stepCost,
    models,
  }));
  return {
    day,
    promptTokens: rows.reduce((s, r) => s + r.promptTokens, 0),
    completionTokens: rows.reduce((s, r) => s + r.completionTokens, 0),
    stepCost: rows.reduce((s, r) => s + r.stepCost, 0),
    agents: rows,
  };
}

describe("weekStartOf", () => {
  it("maps Mon–Sun onto the same Monday", () => {
    expect(weekStartOf("2026-09-07")).toBe("2026-09-07");
    expect(weekStartOf("2026-09-09")).toBe("2026-09-07");
    expect(weekStartOf("2026-09-13")).toBe("2026-09-07");
    expect(weekStartOf("2026-09-14")).toBe("2026-09-14");
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartOf("2026-01-01")).toBe("2025-12-29");
    expect(weekStartOf("2026-09-01")).toBe("2026-08-31");
  });
});

describe("monthStartOf", () => {
  it("labels by the month-start date", () => {
    expect(monthStartOf("2026-09-15")).toBe("2026-09-01");
    expect(monthStartOf("2026-09-01")).toBe("2026-09-01");
  });
});

describe("aggregateBuckets", () => {
  const daily = [
    bucket("2026-09-09", [["a", 0.002]]),
    bucket("2026-09-07", [
      ["a", 0.001],
      ["b", 0.003, ["m1", "m2"]],
    ]),
    bucket("2026-09-08", [["b", 0.004, ["m2", "m1"]]]),
    bucket("2026-10-01", [["a", 0.005]]),
  ];

  it("daily returns a sorted copy without mutating the input", () => {
    const out = aggregateBuckets(daily, "daily" satisfies CostGranularity);
    expect(out.map((b) => b.day)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-10-01"]);
    expect(daily[0].day).toBe("2026-09-09");
    expect(out[0]).not.toBe(daily[1]);
  });

  it("weekly groups Mon–Sun under the Monday label and merges agents", () => {
    const out = aggregateBuckets(daily.slice(0, 3), "weekly");
    expect(out).toHaveLength(1);
    expect(out[0].day).toBe("2026-09-07");
    expect(out[0].stepCost).toBeCloseTo(0.01);
    expect(out[0].promptTokens).toBe(40);
    const byAgent = new Map(out[0].agents.map((a) => [a.agent, a]));
    expect(byAgent.get("a")?.stepCost).toBeCloseTo(0.003);
    expect(byAgent.get("b")?.stepCost).toBeCloseTo(0.007);
    expect(byAgent.get("b")?.models).toEqual(["m1", "m2"]);
  });

  it("weekly splits across Mondays", () => {
    const out = aggregateBuckets(
      [bucket("2026-09-13", [["a", 0.001]]), bucket("2026-09-14", [["a", 0.002]])],
      "weekly",
    );
    expect(out.map((b) => b.day)).toEqual(["2026-09-07", "2026-09-14"]);
  });

  it("monthly groups calendar months under the month-start date", () => {
    const out = aggregateBuckets(daily, "monthly");
    expect(out.map((b) => b.day)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(out[0].stepCost).toBeCloseTo(0.01);
    expect(out[1].stepCost).toBeCloseTo(0.005);
  });

  it("returns empty for empty input in every granularity", () => {
    for (const g of ["daily", "weekly", "monthly"] as const) {
      expect(aggregateBuckets([], g)).toEqual([]);
    }
  });
});

describe("rankAgents", () => {
  it("sorts by total cost desc with a name tie-break", () => {
    const ranked = rankAgents([
      bucket("2026-09-07", [
        ["b", 0.001],
        ["a", 0.001],
        ["c", 0.005],
      ]),
    ]);
    expect(ranked).toEqual([
      ["c", 0.005],
      ["a", 0.001],
      ["b", 0.001],
    ]);
  });

  it("accumulates across buckets", () => {
    const ranked = rankAgents([bucket("2026-09-07", [["a", 0.001]]), bucket("2026-09-08", [["a", 0.002]])]);
    expect(ranked).toEqual([["a", 0.003]]);
  });
});

describe("splitLegend", () => {
  const ranked: Array<[string, number]> = Array.from({ length: 9 }, (_, i) => [`agent-${i}`, 9 - i]);

  it("keeps the top 7 and folds the rest into one overflow row", () => {
    const { visible, overflow } = splitLegend(ranked);
    expect(visible).toHaveLength(7);
    expect(visible[0][0]).toBe("agent-0");
    expect(overflow).toEqual({ count: 2, cost: 3 });
  });

  it("has no overflow at or under the cap", () => {
    expect(splitLegend(ranked.slice(0, 7)).overflow).toBeNull();
    expect(splitLegend([])).toEqual({ visible: [], overflow: null });
  });

  it("respects a custom limit", () => {
    const { visible, overflow } = splitLegend(ranked, 3);
    expect(visible).toHaveLength(3);
    expect(overflow?.count).toBe(6);
  });
});
