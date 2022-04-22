`#version 4`;

`#name Distribute`;

`#description Distribute things along linedefs`;

`#scriptoptions

thingType {
  description = "Thing type";
  type = 18;
  default = 2014;
}
count {
  description = "Number of things";
  type = 0;
  default = 8;
}
`;

const options = UDB.ScriptOptions;
if (options.count <= 0) {
  UDB.die("No things to distribute.");
}

// Find connected components.
const selectedLines = UDB.Map.getSelectedOrHighlightedLinedefs();
if (!selectedLines.length) {
  UDB.die("No linedefs selected.");
}

const lineSet = new Set(selectedLines);
const lineSort = new Map();
const components = [];
let sortIndex = 0;
selectedLines.forEach(line => {
  lineSort.set(line, sortIndex++);
  const component = [];
  const traverse = (self, line) => {
    if (!lineSet.has(line)) {
      return;
    }
    lineSet.delete(line);
    component.push(line);
    line.start.getLinedefs().forEach(o => self(self, o));
    line.end.getLinedefs().forEach(o => self(self, o));
  };
  traverse(traverse, line);
  if (component.length) {
    components.push(component);
  }
});

// Calculate distances at which to insert things.
let totalDistance = 0;
components.forEach(c => c.forEach(line => totalDistance += line.length));
const distances = [];
for (let i = 0; i < options.count; ++i) {
  distances.push((i + 0.5) * (totalDistance / options.count));
}

let distanceIndex = 0;
totalDistance = 0;
components.forEach(component => {
  // Find line to start at, either a line with a single neighbour or the first in selection order.
  const lineSet = new Set(component);
  let start = null;
  for (let i = 0; i < component.length; ++i) {
    const line = component[i];
    const p = o => o != line && lineSet.has(o);
    if (!line.start.getLinedefs().find(p)) {
      start = [line, line.start];
      break;
    } else if (!line.end.getLinedefs().find(p)) {
      start = [line, line.end];
      break;
    }
  }
  if (!start) {
    start = [component[0], component[0].start];
  }

  // DFS and place things.
  const traverse = (self, line, v) => {
    lineSet.delete(line);
    const u = line.start == v ? line.end : line.start;
    while (distanceIndex < distances.length &&
           distances[distanceIndex] <= totalDistance + line.length) {
      const t = (distances[distanceIndex] - totalDistance) / line.length;
      UDB.Map.createThing(UDB.Line2D.getCoordinatesAt(v.position, u.position, t),
                          options.thingType);
      ++distanceIndex;
    }
    totalDistance += line.length;
    const lines = u.getLinedefs();
    lines.sort((a, b) => lineSort.get(a) - lineSort.get(b));
    lines.forEach(o => {
      if (lineSet.has(o)) {
        self(self, o, u);
      }
    });
  };
  traverse(traverse, start[0], start[1]);
});

UDB.exit("Distributed along " + components.length + " component(s).");
