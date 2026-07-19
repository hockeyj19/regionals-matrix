// Breakdown templates inserted into fighter notes via the "+ <label>" buttons
// on the note editors (Notes matrix + Library). Edit freely: `label` is the
// button text, `body` is the block dropped into the note. Add or remove entries
// as you like - the UI renders whatever is in this array.
export const NOTE_TEMPLATES: { label: string; body: string }[] = [
  {
    label: "Breakdown",
    body: [
      "Striking: ",
      "Grappling: ",
      "Cardio / pace: ",
      "Durability: ",
      "Path to victory: ",
      "X-factor: ",
    ].join("\n"),
  },
  {
    label: "Quick read",
    body: ["Style: ", "Matchup edge: ", "Fade if: "].join("\n"),
  },
  {
    label: "Betting angle",
    body: ["Value / number: ", "Lean: ", "Confidence: ", "Live dog?: "].join("\n"),
  },
];
