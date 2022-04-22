`#version 4`;

`#name Extrude`;

`#description Extrude vertices or linedefs`;

`#scriptoptions

distance {
  description = "Extrude distance";
  type = 0;
  default = 64;
}
copy {
  description = "Extrude copy of geometry";
  type = 3;
  default = false;
}
angle {
  description = "Extrude angle adjustment";
  type = 17;
  default = 0;
}
arcAngle {
  description = "Signed arc angle for radial extrude";
  type = 17;
  default = 0;
}
radialVertSelect {
  description = "Treat isolated selected vertex as origin for radial extrude";
  type = 3;
  default = false;
}
`;

// TODO:
// - distance delta
// - angle delta

function otherVertex(linedef, v) {
  return linedef.start == v ? linedef.end : linedef.start;
}

const options = UDB.ScriptOptions;
const selectedVerts = UDB.Map.getSelectedOrHighlightedVertices();
const selectedLines = UDB.Map.getSelectedOrHighlightedLinedefs();
const vertSet = new Set();
const lineSet = new Set();

if (selectedVerts.length) {
  selectedVerts.forEach(v => vertSet.add(v));
} else {
  selectedLines.forEach(line => {
    lineSet.add(line);
    vertSet.add(line.start);
    vertSet.add(line.end);
  });
}

// Find connected components.
const components = [];
while (vertSet.size) {
  const c = {
    verts: new Set(),
    lines: new Set(),
  };
  const traverse = (self, v) => {
    vertSet.delete(v);
    c.verts.add(v);
    v.getLinedefs().forEach(line => {
      const u = otherVertex(line, v);
      if ((!lineSet.size || lineSet.has(line)) &&
          (vertSet.has(u) || c.verts.has(u))) {
        c.lines.add(line);
        if (vertSet.has(u)) {
          self(self, u);
        }
      }
    });
  };

  traverse(traverse, vertSet.values().next().value);
  components.push(c);
}

// Find radial origin vertex, if enabled.
let radialOriginVertex = null;
if (options.radialVertSelect) {
  for (let i = 0; i < components.length; ++i) {
    if (components[i].verts.size == 1 && !components[i].lines.size) {
      radialOriginVertex = components[i].verts.values().next().value;
      components.splice(i, 1);
      break;
    }
  }
}

// Treat each component individually.
components.forEach(c => {
  let endpoints = [];
  let singleVertex = false;

  // Find set of possible endpoints to extrude from:
  // 1) if component is a single vertex, take its neighbours.
  if (c.verts.size == 1) {
    singleVertex = true;
    const v = c.verts.values().next().value;
    const lines = v.getLinedefs();
    c.lines = new Set(lines);
    endpoints = lines.map(line => otherVertex(line, v));
    if (endpoints.length < 2) {
      endpoints.push(v);
    }
  } else {
    // 2) try all vertices only part of 1 linedef in the set.
    c.verts.forEach(v => {
      const lines = v.getLinedefs().filter(line => c.lines.has(line));
      if (lines.length <= 1) {
        endpoints.push(v);
      }
    });
    // 3) if we don't have enough, try vertices part of linedefs not in the set.
    if (endpoints.length < 2) {
      c.verts.forEach(v => {
        const lines = v.getLinedefs().filter(line => c.lines.has(line));
        if (lines.length > 1 && lines.length < v.getLinedefs().length) {
          endpoints.push(v);
        }
      });
    }
    // 4) if we still don't have enough just try all vertices.
    if (endpoints.length < 2) {
      endpoints = Array.from(c.verts);
    }
  }

  // If above process ends up with too many vertices, pick whichever two are separated by
  // the greatest distance.
  if (endpoints.length > 2) {
    let max = 0;
    let maxEndpoints = [];
    for (let i = 0; i < endpoints.length; ++i) {
      for (let j = 0; j < endpoints.length; ++j) {
        const d = UDB.Vector2D.getDistance(endpoints[i].position, endpoints[j].position);
        if (d > max) {
          max = d;
          maxEndpoints = [endpoints[i], endpoints[j]];
        }
      }
    }
    endpoints = maxEndpoints;
  }

  if (endpoints.length != 2) {
    UDB.die("Couldn't determine extrude direction.");
  }

  // If possible, swap endpoints so that endpoints[0] is the start vertex of the whole component
  // and endpoints[1] is the end, so that positive/negative distance will consistently extrude
  // in same direction relative to linedefs.
  if (endpoints[0].getLinedefs().find(line => c.lines.has(line)).start != endpoints[0]) {
    endpoints = [endpoints[1], endpoints[0]];
  }

  // Get perpendicular normal.
  let direction = new UDB.Vector2D(endpoints[1].position.y - endpoints[0].position.y,
                                   endpoints[0].position.x - endpoints[1].position.x)
      .getNormal();

  let radialCentre = null;
  let extrudeDistance = options.distance;
  if (radialOriginVertex) {
    // If we have a chosen radial origin vertex, maintain consistent positive/negative distance
    // by swapping based on whether it lies mostly on front or back of all the linedefs.
    radialCentre = radialOriginVertex.position;
    let d = 0;
    c.lines.forEach(line => {
      const a = line.start.position;
      const b = line.end.position;
      d += (radialCentre.x - a.x) * (b.y - a.y) -
           (radialCentre.y - a.y) * (b.x - a.x);
    });
    if (d < 0) {
      extrudeDistance = -extrudeDistance;
    }
  } else if (options.arcAngle) {
    // If we have a radial arc angle, find the radial origin. There are two possibilities in
    // general; we default to the one on the back-side of the linedefs, negative arc angle will
    // choose the other one. This works out right if we imagine the arc angle is the _signed_
    // angle covered by the linedefs from start vertex to end vertex.
    let arcAngle = Math.abs(options.arcAngle) % 360;
    if (!arcAngle) {
      // This makes 360 degrees work properly for a full circle.
      arcAngle = 180;
    }
    if (options.arcAngle < 0) {
      direction = UDB.Vector2D.reversed(direction);
    } else {
      extrudeDistance = -extrudeDistance;
    }
    if (arcAngle > 180) {
      // If angle > 180, endpoints define a line facing in the opposite direction from actual
      // linedefs, so reverse direction.
      arcAngle = arcAngle - 360;
      direction = UDB.Vector2D.reversed(direction);
    }

    const h = UDB.Vector2D.getDistance(endpoints[0].position, endpoints[1].position);
    const r = h / Math.sqrt(2 - 2 * Math.cos(UDB.Angle2D.degToRad(arcAngle)));
    let d = Math.sqrt(r * r - h * h / 4);
    const mid = [(endpoints[0].position.x + endpoints[1].position.x) / 2,
                 (endpoints[0].position.y + endpoints[1].position.y) / 2];
    radialCentre = new UDB.Vector2D(mid[0] - d * direction.x, mid[1] - d * direction.y);
  } else {
    // For non-radial extrudes, angle parameter just rotates the direction normal.
    direction = direction.getRotated(options.angle);
  }

  // Define extrude function that computes extruded position of a vertex.
  const extrude = v => {
    if (!radialCentre) {
      return [v.position.x + extrudeDistance * direction.x,
              v.position.y + extrudeDistance * direction.y];
    }
    let n = new UDB.Vector2D(radialCentre.x - v.position.x,
                             radialCentre.y - v.position.y).getNormal();
    if (!options.angle) {
      return [v.position.x + extrudeDistance * n.x, v.position.y + extrudeDistance * n.y];
    }
    n = UDB.vector2D.reversed(n).getRotated(options.angle);
    const length = UDB.Vector2D.getDistance(radialCentre, v.position) - extrudeDistance;
    return [radialCentre.x + length * n.x, radialCentre.y + length * n.y];
  };

  if (options.copy) {
    // If copying geometry, find all extruded positions, draw new linedefs between extruded
    // wherever there was a corresponding linedef between original positions, and connect
    // the original endpoints to the extruded endpoints.
    const a = Array.from(c.verts);
    const extruded = a.map(extrude);
    const graph = a.map(v => {
      const r = [];
      for (let i = 0; i < a.length; ++i) {
        if (v.getLinedefs().find(line => line.start == v && line.end == a[i])) {
          r.push(i);
        }
      }
      return r;
    });
    for (let i = 0; i < graph.length; ++i) {
      if (a[i] == endpoints[0]) {
        UDB.Map.drawLines([a[i].position, extruded[i]]);
        UDB.Map.stitchGeometry();
      }
      if (a[i] == endpoints[1]) {
        UDB.Map.drawLines([extruded[i], a[i].position]);
        UDB.Map.stitchGeometry();
      }
    }
    for (let i = 0; i < graph.length; ++i) {
      graph[i].forEach(j => {
        UDB.Map.drawLines([extruded[i], extruded[j]]);
        UDB.Map.stitchGeometry();
      });
    }
    if (singleVertex) {
      // Single vertex case is slightly different here since endpoints weren't part of the
      // actual vertex set.
      UDB.Map.drawLines([endpoints[0].position, extruded[0]]);
      UDB.Map.stitchGeometry();
      UDB.Map.drawLines([extruded[0], endpoints[1].vposition]);
      UDB.Map.stitchGeometry();
    }
  } else {
    // If not copying geometry, just move the vertices and split linedefs at endpoints.
    c.verts.forEach(v => {
      if (v == endpoints[0] || v == endpoints[1]) {
        const lines = v.getLinedefs().filter(line => c.lines.has(line));
        if (lines.length) {
          lines.forEach(line => {
            const s = line.split(extrude(v));
            c.lines.add(s);
            if (selectedVerts.length) {
              v.selected = false;
              s.start.selected = true;
            }
          });
          return;
        }
      }
      v.position = extrude(v);
    });
    UDB.Map.stitchGeometry();
  }
});

UDB.exit("Extruded " + components.length + " section(s).");