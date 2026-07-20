// Breakdown templates inserted into fighter notes via the "+ <label>" buttons
// on the note editors (Notes matrix + Library). Edit freely: `label` is the
// button text, `body` is the block dropped into the note. Add or remove entries
// as you like - the UI renders whatever is in this array.
export const NOTE_TEMPLATES: { label: string; body: string }[] = [
  {
    label: "Styles",
    body: [
      "Striking: ",
      "Grappling: ",
      "Cardio / pace: ",
      "Durability / heart: ",
      "Range: ",
      "Clinch: ",
      "Stance: ",
    ].join("\n"),
  },
  {
    label: "Stats",
    body: [
      "Size / weight / height / reach: ",
      "TKO / sub / dec: ",
      "Strength of schedule: ",
    ].join("\n"),
  },
  {
    label: "Intangibles",
    body: [
      "Injuries: ",
      "Short notice: ",
      "Hometown / long travel: ",
      "Camps / coaches / training partners / credentials: ",
    ].join("\n"),
  },
];
